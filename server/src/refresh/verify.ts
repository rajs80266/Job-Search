import { VERIFY_BUDGET_MS } from "../config";
import { drainAdapter } from "../adapters/drain";
import { resolveAdapter } from "../adapters";
import { localDateString } from "../lib/dates";
import { type VerificationPatch, loadRecipe, writeVerification } from "../recipes/store";
import type {
  AdapterRegistry,
  CompanyRecipe,
  FetchContext,
  HttpClient,
  VerifyResult,
} from "../types";
import { validateAndDedupe } from "./normalize";

const SAMPLE_TITLE_COUNT = 3;
const MAX_LAST_ERROR_LENGTH = 500;

export interface VerifyDeps {
  http: HttpClient;
  adapters: AdapterRegistry;
  now?: () => Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs the recipe live with no keywords and one page: proves the endpoint answers and the
 * response parses, regardless of how many relevant jobs exist today. Writes nothing.
 */
export async function verifyRecipe(recipe: CompanyRecipe, deps: VerifyDeps): Promise<VerifyResult> {
  const startedAt = Date.now();
  const result: VerifyResult = {
    ok: false,
    jobCount: 0,
    sampleTitles: [],
    error: null,
    warnings: [],
    durationMs: 0,
    saved: false,
  };

  try {
    const adapter = resolveAdapter(deps.adapters, recipe);

    const ctx: FetchContext = {
      http: deps.http,
      signal: AbortSignal.timeout(VERIFY_BUDGET_MS),
      keywords: [],
      maxPages: 1,
      knownExternalIds: new Set(),
      now: (deps.now ?? (() => new Date()))(),
    };
    const drained = await drainAdapter(adapter, recipe, ctx);
    const { jobs, invalid } = validateAndDedupe(drained.jobs);

    result.jobCount = jobs.length;
    result.sampleTitles = jobs.slice(0, SAMPLE_TITLE_COUNT).map((job) => job.title);
    if (invalid > 0) result.warnings.push(`${invalid} job(s) were invalid and dropped`);

    const [sampleJob] = jobs;
    if (!sampleJob) {
      result.error =
        drained.jobs.length === 0
          ? "the endpoint returned no jobs"
          : `all ${drained.jobs.length} jobs are invalid (missing id, title or absolute url)`;
    } else {
      result.ok = true;
      if (adapter.fetchDescription) {
        try {
          await adapter.fetchDescription(sampleJob, recipe, ctx);
        } catch (error) {
          result.warnings.push(`sample description request failed: ${errorMessage(error)}`);
        }
      }
    }
  } catch (error) {
    result.error = errorMessage(error);
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

/** The only place that decides recipe status transitions (ARCHITECTURE §2 "Status lifecycle"). */
export function verificationPatch(
  recipe: CompanyRecipe,
  result: Pick<VerifyResult, "ok" | "error">,
  today: string,
): VerificationPatch {
  if (result.ok) return { status: "verified", verifiedOn: today, lastError: undefined };

  return {
    status: recipe.status === "unverified" ? "unverified" : "broken",
    verifiedOn: recipe.verifiedOn,
    lastError: (result.error ?? "verify failed").slice(0, MAX_LAST_ERROR_LENGTH),
  };
}

export class NotVerifiableError extends Error {
  constructor(recipe: CompanyRecipe) {
    super(
      `"${recipe.slug}" is ${recipe.status}; only unverified, verified or broken recipes can be verified`,
    );
    this.name = "NotVerifiableError";
  }
}

export function isVerifiable(recipe: CompanyRecipe): boolean {
  return recipe.status !== "needs-manual" && recipe.status !== "disabled";
}

/** Verifies the recipe file and writes the outcome back to it (verifiedOn, status, lastError). */
export async function verifyAndSaveRecipe(
  recipesDir: string,
  slug: string,
  deps: VerifyDeps,
): Promise<VerifyResult> {
  const recipe = loadRecipe(recipesDir, slug);
  if (!isVerifiable(recipe)) throw new NotVerifiableError(recipe);

  const result = await verifyRecipe(recipe, deps);
  const today = localDateString((deps.now ?? (() => new Date()))());
  writeVerification(recipesDir, slug, verificationPatch(recipe, result, today));
  return { ...result, saved: true };
}
