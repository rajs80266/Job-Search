import {
  COMPANY_BUDGET_MS,
  COMPANY_CONCURRENCY,
  DETAIL_REQUESTS_PER_COMPANY,
  STALE_JOB_DAYS,
} from "../config";
import { drainAdapter } from "../adapters/drain";
import { resolveAdapter } from "../adapters";
import { getCompany, recordCompanyFailure, recordCompanySuccess } from "../db/companies";
import type { Db } from "../db/connection";
import {
  type StoredJobSummary,
  closeUnseenJobs,
  listStoredJobSummaries,
  upsertJob,
} from "../db/jobs";
import { finishRun, getRunSummary, insertCompanyResult, startRun } from "../db/refresh-runs";
import { mapWithConcurrency } from "../lib/concurrency";
import { parseLocation } from "../lib/location";
import { toSnippet } from "../lib/text";
import { findBoilerplateConcepts } from "../scoring/boilerplate";
import { type CompiledProfile, compileProfile } from "../scoring/compile-profile";
import { titleMatchesCore } from "../scoring/relevance";
import { syncCompanies, type InvalidRecipeFile } from "../recipes/store";
import {
  type Adapter,
  type AdapterRegistry,
  type CompanyRecipe,
  type FetchContext,
  type FetchedJob,
  type HttpClient,
  type NormalizedJob,
  type Profile,
  REFRESHABLE_STATUSES,
  type RefreshCompanyResult,
  type RefreshMode,
  type RefreshRequest,
  type RefreshRunSummary,
} from "../types";
import { RefreshEvents } from "./events";
import { normalizeJob, validateAndDedupe } from "./normalize";

export const EMPTY_COMPLETE_FETCH_MESSAGE = "empty complete fetch – not closing";
export const PAGE_CAP_MESSAGE =
  "page cap reached – jobs beyond it were not read; raise pagination.maxPages if the board is larger";

const DAY_MS = 24 * 60 * 60 * 1000;

export class RefreshAlreadyRunningError extends Error {
  readonly runId: number;

  constructor(runId: number) {
    super(`A refresh is already running (run ${runId})`);
    this.name = "RefreshAlreadyRunningError";
    this.runId = runId;
  }
}

export class UnknownCompanyError extends Error {
  constructor(slug: string) {
    super(`No valid recipe for company "${slug}"`);
    this.name = "UnknownCompanyError";
  }
}

export interface RefreshServiceDeps {
  db: Db;
  http: HttpClient;
  adapters: AdapterRegistry;
  recipesDir: string;
  /** Called at the start of every run, so profile edits apply to the next refresh. */
  loadProfile: () => Profile;
  events?: RefreshEvents;
  now?: () => Date;
}

export interface StartedRefresh {
  runId: number;
  /** Recipe files that failed validation and are therefore not part of this run. */
  invalidFiles: InvalidRecipeFile[];
  /** Resolves when the run has finished; rejects only if the run itself crashed. */
  done: Promise<RefreshRunSummary>;
}

interface FetchedCompany {
  jobs: NormalizedJob[];
  openExternalIdsBefore: number;
  existingExternalIds: ReadonlySet<string>;
  complete: boolean;
  stopReason: RefreshCompanyResult["stopReason"];
  pagesFetched: number;
  jobsInvalid: number;
  detailsFetched: number;
  detailsFailed: number;
  fetchedAt: Date;
}

interface RunContext {
  runId: number;
  mode: RefreshMode;
  profile: CompiledProfile;
}

export function createRefreshService(deps: RefreshServiceDeps) {
  const { db, http, adapters, recipesDir } = deps;
  const events = deps.events ?? new RefreshEvents();
  const now = deps.now ?? (() => new Date());
  let activeRunId: number | null = null;
  const runningCompanies = new Set<string>();

  function selectRecipes(recipes: CompanyRecipe[], company: string | undefined): CompanyRecipe[] {
    if (company === undefined) {
      return recipes.filter((recipe) => REFRESHABLE_STATUSES.includes(recipe.status));
    }
    const recipe = recipes.find((candidate) => candidate.slug === company);
    if (!recipe) throw new UnknownCompanyError(company);
    return [recipe];
  }

  function startRefresh(request: RefreshRequest): StartedRefresh {
    if (activeRunId !== null) throw new RefreshAlreadyRunningError(activeRunId);

    const { recipes, invalidFiles } = syncCompanies(db, recipesDir);
    const selected = selectRecipes(recipes, request.company);
    const runId = startRun(db, {
      companySlug: request.company ?? null,
      full: request.full,
      startedAt: now().toISOString(),
    });
    activeRunId = runId;

    const mode: RefreshMode = request.full ? "full" : "incremental";
    const done = executeRun(selected, runId, mode).finally(() => {
      activeRunId = null;
    });
    return { runId, invalidFiles, done };
  }

  async function executeRun(
    recipes: CompanyRecipe[],
    runId: number,
    mode: RefreshMode,
  ): Promise<RefreshRunSummary> {
    // Lets the caller subscribe to events before the first one is published.
    await Promise.resolve();

    try {
      const profile = compileProfile(deps.loadProfile());
      const run: RunContext = { runId, mode, profile };
      await mapWithConcurrency(recipes, COMPANY_CONCURRENCY, (recipe) =>
        refreshCompany(recipe, run),
      );
      finishRun(db, runId, "finished", now().toISOString());
    } catch (error) {
      finishRun(db, runId, "aborted", now().toISOString());
      // Listeners (the SSE stream, so the UI) must hear that the run ended, or they wait forever.
      events.publish(runId, { type: "run-finished", run: requireSummary(runId) });
      throw error;
    }

    const summary = requireSummary(runId);
    events.publish(runId, { type: "run-finished", run: summary });
    return summary;
  }

  function requireSummary(runId: number): RefreshRunSummary {
    const summary = getRunSummary(db, runId);
    if (!summary) throw new Error(`Refresh run ${runId} disappeared`);
    return summary;
  }

  async function refreshCompany(recipe: CompanyRecipe, run: RunContext): Promise<void> {
    const startedAt = now().toISOString();
    runningCompanies.add(recipe.slug);
    events.publish(run.runId, {
      type: "company-started",
      runId: run.runId,
      companySlug: recipe.slug,
      at: startedAt,
    });

    const base = { runId: run.runId, companySlug: recipe.slug, mode: run.mode, startedAt };
    let result: RefreshCompanyResult;

    if (!REFRESHABLE_STATUSES.includes(recipe.status)) {
      result = emptyResult(
        base,
        "skipped",
        `status is ${recipe.status}; only verified or broken recipes are refreshed`,
      );
      insertCompanyResult(db, result);
    } else {
      try {
        const fetched = await fetchCompany(recipe, run);
        result = storeCompany(recipe, base, fetched);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result = emptyResult(base, "failed", message);
        db.transaction(() => {
          recordCompanyFailure(db, recipe.slug, result.finishedAt ?? startedAt, message);
          insertCompanyResult(db, result);
        })();
      }
    }

    runningCompanies.delete(recipe.slug);
    events.publish(run.runId, { type: "company-finished", result });
  }

  function emptyResult(
    base: Pick<RefreshCompanyResult, "runId" | "companySlug" | "mode" | "startedAt">,
    status: "failed" | "skipped",
    message: string,
  ): RefreshCompanyResult {
    return {
      ...base,
      status,
      finishedAt: now().toISOString(),
      jobsFetched: 0,
      jobsNew: 0,
      jobsClosed: 0,
      jobsInvalid: 0,
      pagesFetched: 0,
      detailsFetched: 0,
      detailsFailed: 0,
      stopReason: null,
      message,
    };
  }

  /** Network and normalization only: nothing is written, so a failure leaves no partial data. */
  async function fetchCompany(recipe: CompanyRecipe, run: RunContext): Promise<FetchedCompany> {
    const adapter = resolveAdapter(adapters, recipe);
    if (!recipe.fetch) throw new Error(`${recipe.slug} has no fetch settings`);

    const stored = listStoredJobSummaries(db, recipe.slug);
    const storedByExternalId = new Map(stored.map((job) => [job.externalId, job]));
    const openExternalIds = stored
      .filter((job) => job.closedAt === null)
      .map((job) => job.externalId);

    const fetchedAt = now();
    const ctx: FetchContext = {
      http,
      signal: AbortSignal.timeout(COMPANY_BUDGET_MS),
      keywords: recipe.filters.keywords,
      maxPages: recipe.fetch.pagination.maxPages,
      knownExternalIds: run.mode === "full" ? new Set() : new Set(openExternalIds),
      now: fetchedAt,
    };

    const drained = await drainAdapter(adapter, recipe, ctx);
    const { jobs, invalid } = validateAndDedupe(drained.jobs);
    if (drained.jobs.length > 0 && jobs.length === 0) {
      throw new Error(
        `all ${drained.jobs.length} fetched jobs are invalid; the parser may be broken`,
      );
    }

    const details = await requestDescriptions(
      adapter,
      recipe,
      ctx,
      jobs,
      storedByExternalId,
      run.profile,
    );
    const descriptionOf = (job: FetchedJob): string =>
      job.description ||
      details.descriptions.get(job.externalId) ||
      storedByExternalId.get(job.externalId)?.descriptionSnippet ||
      "";
    const fetchedExternalIds = new Set(jobs.map((job) => job.externalId));
    const companyDescriptions = [
      ...jobs.map((job) => toSnippet(descriptionOf(job))),
      ...stored
        .filter((job) => job.closedAt === null && !fetchedExternalIds.has(job.externalId))
        .map((job) => job.descriptionSnippet),
    ];
    const boilerplateConcepts = findBoilerplateConcepts(companyDescriptions, run.profile);
    const normalized = jobs.map((job) =>
      normalizeJob({
        job,
        companySlug: recipe.slug,
        indiaFiltered: recipe.filters.indiaFiltered,
        description: descriptionOf(job),
        fetchedAt,
        profile: run.profile,
        boilerplateConcepts,
      }),
    );

    return {
      jobs: normalized,
      openExternalIdsBefore: openExternalIds.length,
      existingExternalIds: new Set(storedByExternalId.keys()),
      complete: drained.outcome.complete,
      stopReason: drained.outcome.stopReason,
      pagesFetched: drained.outcome.pagesFetched,
      jobsInvalid: invalid,
      detailsFetched: details.fetched,
      detailsFailed: details.failed,
      fetchedAt,
    };
  }

  /** ARCHITECTURE §5 "Description requests": at most one detail GET per qualifying job. */
  async function requestDescriptions(
    adapter: Adapter,
    recipe: CompanyRecipe,
    ctx: FetchContext,
    jobs: FetchedJob[],
    storedByExternalId: ReadonlyMap<string, StoredJobSummary>,
    profile: CompiledProfile,
  ): Promise<{ descriptions: Map<string, string>; fetched: number; failed: number }> {
    const outcome = { descriptions: new Map<string, string>(), fetched: 0, failed: 0 };
    if (!adapter.fetchDescription) return outcome;

    const qualifying = jobs
      .filter(
        (job) =>
          job.description === "" &&
          !storedByExternalId.get(job.externalId)?.descriptionSnippet &&
          parseLocation(job.locationRaw, recipe.filters.indiaFiltered, profile).isIndia &&
          titleMatchesCore(job.title, profile),
      )
      .slice(0, DETAIL_REQUESTS_PER_COMPANY);

    for (const job of qualifying) {
      outcome.fetched++;
      try {
        outcome.descriptions.set(job.externalId, await adapter.fetchDescription(job, recipe, ctx));
      } catch {
        outcome.failed++;
      }
    }
    return outcome;
  }

  /** ONE transaction: jobs, closures, company row and result row succeed or fail together. */
  function storeCompany(
    recipe: CompanyRecipe,
    base: Pick<RefreshCompanyResult, "runId" | "companySlug" | "mode" | "startedAt">,
    fetched: FetchedCompany,
  ): RefreshCompanyResult {
    return db.transaction((): RefreshCompanyResult => {
      const isBaseline = !getCompany(db, recipe.slug)?.firstSuccessAt;
      const fetchedAtIso = fetched.fetchedAt.toISOString();
      let inserted = 0;

      for (const job of fetched.jobs) {
        if (!fetched.existingExternalIds.has(job.externalId)) inserted++;
        upsertJob(db, job);
      }

      let closed = 0;
      let message: string | null = null;
      if (fetched.jobs.length === 0 && fetched.openExternalIdsBefore > 0 && fetched.complete) {
        message = EMPTY_COMPLETE_FETCH_MESSAGE;
      } else if (
        fetched.jobs.length > 0 &&
        (fetched.complete || fetched.stopReason === "page-cap")
      ) {
        const seen = new Set(fetched.jobs.map((job) => job.externalId));
        const notSeenSince = fetched.complete
          ? null
          : new Date(fetched.fetchedAt.getTime() - STALE_JOB_DAYS * DAY_MS).toISOString();
        closed = closeUnseenJobs(db, recipe.slug, seen, fetchedAtIso, notSeenSince);
      }
      if (fetched.stopReason === "page-cap") message = PAGE_CAP_MESSAGE;

      recordCompanySuccess(db, recipe.slug, fetchedAtIso);
      const result: RefreshCompanyResult = {
        ...base,
        status: "ok",
        finishedAt: now().toISOString(),
        jobsFetched: fetched.jobs.length,
        jobsNew: isBaseline ? 0 : inserted,
        jobsClosed: closed,
        jobsInvalid: fetched.jobsInvalid,
        pagesFetched: fetched.pagesFetched,
        detailsFetched: fetched.detailsFetched,
        detailsFailed: fetched.detailsFailed,
        stopReason: fetched.stopReason,
        message,
      };
      insertCompanyResult(db, result);
      return result;
    })();
  }

  return {
    startRefresh,
    events,
    getActiveRunId: () => activeRunId,
    /** Companies of the active run that have started but not finished. */
    getRunningCompanies: (): string[] => [...runningCompanies],
  };
}

export type RefreshService = ReturnType<typeof createRefreshService>;
