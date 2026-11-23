import { beforeEach, describe, expect, it } from "vitest";
import { getCompany } from "../../src/db/companies";
import { type Db, openDatabase } from "../../src/db/connection";
import { getJobStatus, upsertJobStatus } from "../../src/db/job-status";
import { listJobs } from "../../src/db/jobs";
import { getRunSummary, listCompanyResults } from "../../src/db/refresh-runs";
import {
  EMPTY_COMPLETE_FETCH_MESSAGE,
  PAGE_CAP_MESSAGE,
  RefreshAlreadyRunningError,
  UnknownCompanyError,
  createRefreshService,
} from "../../src/refresh/service";
import type { Adapter, FetchedJob, RefreshEvent } from "../../src/types";
import {
  type Batch,
  fakeHttp,
  makeJob,
  makeTempDir,
  scriptedAdapter,
  testProfile,
  writeRecipeFile,
} from "../helpers";

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";
const T3 = "2026-11-03T00:00:00.000Z";
const T_AFTER_STALE_WINDOW = "2026-11-20T00:00:00.000Z";

interface Harness {
  db: Db;
  clock: { time: string };
  refresh: (request?: { company?: string; full?: boolean }) => Promise<number>;
  service: ReturnType<typeof createRefreshService>;
  setBatches: (batches: Batch[]) => void;
}

function createHarness(options: {
  slugs?: string[];
  adapter?: (nextBatch: () => Batch) => Adapter;
  recipeOverrides?: Record<string, Record<string, unknown>>;
}): Harness {
  const db = openDatabase(":memory:");
  const recipesDir = makeTempDir();
  const slugs = options.slugs ?? ["acme"];
  for (const slug of slugs) writeRecipeFile(recipesDir, slug, options.recipeOverrides?.[slug]);

  const clock = { time: T1 };
  let queued: Batch[] = [];
  const nextBatch = (): Batch => queued.shift() ?? { jobs: [] };
  const adapter = options.adapter?.(nextBatch) ?? scriptedAdapter(nextBatch);

  const service = createRefreshService({
    db,
    http: fakeHttp(() => {
      throw new Error("the fake adapter must not use the network");
    }).client,
    adapters: { greenhouse: adapter },
    recipesDir,
    loadProfile: () => testProfile,
    now: () => new Date(clock.time),
  });

  return {
    db,
    clock,
    service,
    setBatches: (batches) => {
      queued = [...batches];
    },
    refresh: async (request = {}) => {
      const started = service.startRefresh({ full: false, ...request });
      await started.done;
      return started.runId;
    },
  };
}

const onlyResult = (db: Db, runId: number) => {
  const [result, ...rest] = listCompanyResults(db, runId);
  expect(rest).toHaveLength(0);
  if (!result) throw new Error("no result recorded");
  return result;
};

describe("refresh service: new, updated and closed jobs", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness({});
  });

  it("treats the first successful fetch as a baseline: stored, but nothing is new", async () => {
    harness.setBatches([{ jobs: [makeJob("1"), makeJob("2")] }]);

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "ok",
      jobsFetched: 2,
      jobsNew: 0,
      jobsClosed: 0,
      stopReason: "end",
    });
    expect(listJobs(harness.db, "acme").map((job) => job.externalId)).toEqual(["1", "2"]);
    expect(getCompany(harness.db, "acme")).toMatchObject({
      firstSuccessAt: T1,
      lastSuccessAt: T1,
      lastRefreshError: null,
    });
  });

  it("sets first/last seen and counts only later additions as new", async () => {
    harness.setBatches([
      { jobs: [makeJob("1"), makeJob("2")] },
      { jobs: [makeJob("1"), makeJob("2"), makeJob("3")] },
    ]);
    await harness.refresh();
    harness.clock.time = T2;

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({ jobsFetched: 3, jobsNew: 1 });
    const byId = Object.fromEntries(
      listJobs(harness.db, "acme").map((job) => [job.externalId, job]),
    );
    expect(byId["1"]).toMatchObject({ firstSeenAt: T1, lastSeenAt: T2, closedAt: null });
    expect(byId["3"]).toMatchObject({ firstSeenAt: T2, lastSeenAt: T2, closedAt: null });
  });

  it("closes jobs missing from a complete fetch and reopens them when they return", async () => {
    harness.setBatches([
      { jobs: [makeJob("1"), makeJob("2")] },
      { jobs: [makeJob("1")] },
      { jobs: [makeJob("1"), makeJob("2")] },
    ]);
    await harness.refresh();

    harness.clock.time = T2;
    const closingRun = await harness.refresh();
    expect(onlyResult(harness.db, closingRun)).toMatchObject({ jobsClosed: 1, jobsNew: 0 });
    expect(listJobs(harness.db, "acme").find((job) => job.externalId === "2")?.closedAt).toBe(T2);

    harness.clock.time = T3;
    const reopeningRun = await harness.refresh();
    const reopened = listJobs(harness.db, "acme").find((job) => job.externalId === "2");
    expect(reopened).toMatchObject({ closedAt: null, firstSeenAt: T1, lastSeenAt: T3 });
    expect(onlyResult(harness.db, reopeningRun)).toMatchObject({ jobsClosed: 0 });
  });

  it.each(["page-cap", "known-ids"] as const)(
    "closes nothing when the fetch stops with %s",
    async (stopReason) => {
      harness.setBatches([
        { jobs: [makeJob("1"), makeJob("2")] },
        { jobs: [makeJob("1")], outcome: { complete: false, stopReason } },
      ]);
      await harness.refresh();
      harness.clock.time = T2;

      const runId = await harness.refresh();

      expect(onlyResult(harness.db, runId)).toMatchObject({
        status: "ok",
        jobsClosed: 0,
        stopReason,
      });
      expect(listJobs(harness.db, "acme").every((job) => job.closedAt === null)).toBe(true);
    },
  );

  it("does not close everything when a complete fetch suddenly returns no jobs", async () => {
    harness.setBatches([{ jobs: [makeJob("1")] }, { jobs: [] }]);
    await harness.refresh();
    harness.clock.time = T2;

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "ok",
      jobsClosed: 0,
      message: EMPTY_COMPLETE_FETCH_MESSAGE,
    });
    expect(listJobs(harness.db, "acme")[0]?.closedAt).toBeNull();
  });

  it("de-duplicates by externalId and drops invalid jobs, counting them", async () => {
    harness.setBatches([
      {
        jobs: [
          makeJob("1"),
          makeJob("1", { title: "Duplicate listing" }),
          makeJob("2", { url: "/relative/path" }),
          makeJob("", { title: "No id" }),
          makeJob("3", { title: "   " }),
        ],
      },
    ]);

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "ok",
      jobsFetched: 1,
      jobsInvalid: 3,
    });
    expect(listJobs(harness.db, "acme")[0]?.title).toBe("Engineer 1");
  });

  it("fails the company when every fetched job is invalid, because the parser is broken", async () => {
    harness.setBatches([{ jobs: [makeJob("1", { url: "" }), makeJob("2", { url: "" })] }]);

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "failed",
      message: expect.stringContaining("invalid") as unknown,
    });
    expect(listJobs(harness.db, "acme")).toHaveLength(0);
  });

  it("keeps a job's status and notes across refreshes", async () => {
    harness.setBatches([{ jobs: [makeJob("1")] }, { jobs: [makeJob("1", { title: "Renamed" })] }]);
    await harness.refresh();
    const [job] = listJobs(harness.db, "acme");
    if (!job) throw new Error("job missing");
    upsertJobStatus(harness.db, job.id, { status: "saved", notes: "call recruiter" }, T1);
    harness.clock.time = T2;

    await harness.refresh();

    expect(listJobs(harness.db, "acme")[0]?.title).toBe("Renamed");
    expect(getJobStatus(harness.db, job.id)).toMatchObject({
      status: "saved",
      notes: "call recruiter",
    });
  });

  it("derives location, score and snippet through the shared normalization", async () => {
    harness.setBatches([
      {
        jobs: [
          makeJob("1", {
            title: "Dialogflow CX Developer",
            locationRaw: "Bangalore, India",
            description: "<p>Build <b>virtual agents</b> &amp; IVR flows</p>",
            postedRaw: "2026-10-30T10:00:00+05:30",
          }),
        ],
      },
    ]);

    await harness.refresh();

    expect(listJobs(harness.db, "acme")[0]).toMatchObject({
      cities: ["Bengaluru"],
      isIndia: true,
      relevanceTier: "high",
      matchedKeywords: ["Dialogflow CX", "virtual agent", "IVR"],
      descriptionSnippet: "Build virtual agents & IVR flows",
      postedAt: "2026-10-30T04:30:00.000Z",
    });
  });
});

describe("refresh service: modes and run selection", () => {
  it("passes open job IDs to incremental fetches but none to full fetches", async () => {
    const seen: ReadonlySet<string>[] = [];
    const harness = createHarness({
      adapter: (nextBatch) =>
        scriptedAdapter((_recipe, ctx) => {
          seen.push(ctx.knownExternalIds);
          return nextBatch();
        }),
    });
    harness.setBatches([{ jobs: [makeJob("1"), makeJob("2")] }, { jobs: [] }, { jobs: [] }]);

    await harness.refresh();
    await harness.refresh();
    await harness.refresh({ full: true });

    expect([...(seen[0] ?? [])]).toEqual([]);
    expect([...(seen[1] ?? [])].sort()).toEqual(["1", "2"]);
    expect([...(seen[2] ?? [])]).toEqual([]);
  });

  it("uses the recipe keywords and page cap from the recipe", async () => {
    let seenContext: { keywords: readonly string[]; maxPages: number } | undefined;
    const harness = createHarness({
      recipeOverrides: {
        acme: {
          filters: { keywords: ["Dialogflow"] },
          fetch: {
            url: "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
            pagination: { maxPages: 3 },
          },
        },
      },
      adapter: (nextBatch) =>
        scriptedAdapter((_recipe, ctx) => {
          seenContext = { keywords: ctx.keywords, maxPages: ctx.maxPages };
          return nextBatch();
        }),
    });
    harness.setBatches([{ jobs: [makeJob("1")] }]);

    await harness.refresh();

    expect(seenContext).toEqual({ keywords: ["Dialogflow"], maxPages: 3 });
  });

  it("refreshes only verified and broken recipes when running all companies", async () => {
    const harness = createHarness({
      slugs: ["verified-co", "broken-co", "new-co", "off-co"],
      recipeOverrides: {
        "broken-co": { status: "broken", lastError: "HTTP 404" },
        "new-co": { status: "unverified", verifiedOn: undefined },
        "off-co": { status: "disabled" },
      },
    });
    harness.setBatches([{ jobs: [makeJob("1")] }, { jobs: [makeJob("1")] }]);

    const runId = await harness.refresh();

    expect(listCompanyResults(harness.db, runId).map((result) => result.companySlug)).toEqual([
      "broken-co",
      "verified-co",
    ]);
  });

  it("records a skipped result with the reason when a single non-refreshable company is requested", async () => {
    const harness = createHarness({
      slugs: ["new-co"],
      recipeOverrides: { "new-co": { status: "unverified", verifiedOn: undefined } },
    });

    const runId = await harness.refresh({ company: "new-co" });

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "skipped",
      message: expect.stringContaining("unverified") as unknown,
    });
    expect(getRunSummary(harness.db, runId)?.totals).toMatchObject({ companies: 1, skipped: 1 });
  });

  it("rejects an unknown company before creating a run", () => {
    const harness = createHarness({});

    expect(() => harness.service.startRefresh({ company: "nope", full: false })).toThrow(
      UnknownCompanyError,
    );
    expect(harness.db.prepare("SELECT COUNT(*) AS n FROM refresh_runs").get()).toEqual({ n: 0 });
  });

  it("allows one run at a time and reports the active run id", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: [makeJob("1")] }]);

    const first = harness.service.startRefresh({ full: false });
    let rejection: unknown;
    try {
      harness.service.startRefresh({ full: false });
    } catch (error) {
      rejection = error;
    }
    await first.done;

    expect(rejection).toBeInstanceOf(RefreshAlreadyRunningError);
    expect((rejection as RefreshAlreadyRunningError).runId).toBe(first.runId);
    expect(() => harness.service.startRefresh({ full: false })).not.toThrow();
  });

  it("reports recipe files that failed validation without stopping the run", async () => {
    const harness = createHarness({
      slugs: ["acme", "broken-file"],
      recipeOverrides: { "broken-file": { category: "nope" } },
    });
    harness.setBatches([{ jobs: [makeJob("1")] }]);

    const started = harness.service.startRefresh({ full: false });
    await started.done;

    expect(started.invalidFiles.map((file) => file.file)).toEqual(["broken-file.json"]);
    expect(listCompanyResults(harness.db, started.runId)).toHaveLength(1);
  });
});

describe("refresh service: failure isolation", () => {
  it("fails one company without touching the others or leaving partial data", async () => {
    const harness = createHarness({
      slugs: ["alpha", "beta"],
      adapter: (nextBatch) => ({
        ats: "greenhouse",
        async *fetchJobs(recipe) {
          await Promise.resolve();
          if (recipe.slug === "alpha") {
            yield makeJob("a1");
            throw new Error("HTTP 500 for https://alpha.example/jobs");
          }
          for (const job of nextBatch().jobs ?? []) yield job;
          return { complete: true, stopReason: "end", pagesFetched: 1 };
        },
      }),
    });
    harness.setBatches([{ jobs: [makeJob("b1")] }]);

    const runId = await harness.refresh();

    const results = listCompanyResults(harness.db, runId);
    expect(results.map((result) => [result.companySlug, result.status])).toEqual([
      ["alpha", "failed"],
      ["beta", "ok"],
    ]);
    expect(results[0]?.message).toContain("HTTP 500");
    expect(listJobs(harness.db, "alpha")).toHaveLength(0);
    expect(listJobs(harness.db, "beta")).toHaveLength(1);
    expect(getCompany(harness.db, "alpha")).toMatchObject({
      lastRefreshError: "HTTP 500 for https://alpha.example/jobs",
      lastAttemptAt: T1,
      lastSuccessAt: null,
    });
    expect(getRunSummary(harness.db, runId)).toMatchObject({
      status: "finished",
      totals: { companies: 2, ok: 1, failed: 1 },
    });
  });

  it("keeps old jobs and the last success time when a later fetch fails", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: [makeJob("1")] }, { error: new Error("timed out") }]);
    await harness.refresh();
    harness.clock.time = T2;

    await harness.refresh();

    expect(listJobs(harness.db, "acme")[0]?.closedAt).toBeNull();
    expect(getCompany(harness.db, "acme")).toMatchObject({
      lastSuccessAt: T1,
      lastAttemptAt: T2,
      lastRefreshError: "timed out",
    });
  });

  it("clears the stored error after a later success", async () => {
    const harness = createHarness({});
    harness.setBatches([{ error: new Error("boom") }, { jobs: [makeJob("1")] }]);
    await harness.refresh();

    await harness.refresh();

    expect(getCompany(harness.db, "acme")?.lastRefreshError).toBeNull();
  });

  it("fails only the company whose ATS has no adapter yet", async () => {
    const harness = createHarness({
      slugs: ["acme", "leverco"],
      recipeOverrides: {
        leverco: {
          ats: "lever",
          fetch: { url: "https://api.lever.co/v0/postings/leverco?mode=json" },
        },
      },
    });
    harness.setBatches([{ jobs: [makeJob("1")] }]);

    const runId = await harness.refresh();

    const byCompany = Object.fromEntries(
      listCompanyResults(harness.db, runId).map((result) => [result.companySlug, result]),
    );
    expect(byCompany["acme"]?.status).toBe("ok");
    expect(byCompany["leverco"]).toMatchObject({
      status: "failed",
      message: "no adapter for lever",
    });
  });
});

describe("refresh service: progress events", () => {
  it("publishes company-started, company-finished and run-finished in order", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: [makeJob("1")] }]);

    const started = harness.service.startRefresh({ full: false });
    const received: RefreshEvent[] = [];
    harness.service.events.subscribe(started.runId, (event) => received.push(event));
    await started.done;

    expect(received.map((event) => event.type)).toEqual([
      "company-started",
      "company-finished",
      "run-finished",
    ]);
    const finished = received[2];
    expect(finished).toMatchObject({
      type: "run-finished",
      run: { status: "finished", totals: { ok: 1 } },
    });
  });
});

describe("refresh service: description requests", () => {
  const dialogflowTitle = (n: number): string => `Dialogflow CX Developer ${n}`;

  function harnessWithDetails(fetchDescription: NonNullable<Adapter["fetchDescription"]>) {
    return createHarness({
      adapter: (nextBatch) => scriptedAdapter(nextBatch, { fetchDescription }),
    });
  }

  it("requests a description only for India jobs whose title matches a core keyword", async () => {
    const requested: string[] = [];
    const harness = harnessWithDetails((job) => {
      requested.push(job.externalId);
      return Promise.resolve("<p>Build Dialogflow CX agents with CCAI</p>");
    });
    harness.setBatches([
      {
        jobs: [
          makeJob("match", { title: dialogflowTitle(1) }),
          makeJob("abroad", { title: dialogflowTitle(2), locationRaw: "London, UK" }),
          makeJob("other-title", { title: "Accountant" }),
          makeJob("has-description", { title: dialogflowTitle(3), description: "Already here" }),
        ],
      },
    ]);

    const runId = await harness.refresh();

    expect(requested).toEqual(["match"]);
    expect(onlyResult(harness.db, runId)).toMatchObject({ detailsFetched: 1, detailsFailed: 0 });
    const match = listJobs(harness.db, "acme").find((job) => job.externalId === "match");
    expect(match?.descriptionSnippet).toBe("Build Dialogflow CX agents with CCAI");
    expect(match?.matchedKeywords).toEqual(["Dialogflow CX", "CCAI"]);
  });

  it("requests descriptions for jobs of an India-filtered recipe even with an unparseable location", async () => {
    const requested: string[] = [];
    const harness = createHarness({
      recipeOverrides: { acme: { filters: { indiaFiltered: true } } },
      adapter: (nextBatch) =>
        scriptedAdapter(nextBatch, {
          fetchDescription: (job) => {
            requested.push(job.externalId);
            return Promise.resolve("details");
          },
        }),
    });
    harness.setBatches([
      { jobs: [makeJob("1", { title: dialogflowTitle(1), locationRaw: "2 Locations" })] },
    ]);

    await harness.refresh();

    expect(requested).toEqual(["1"]);
  });

  it("makes at most 20 requests per company per run", async () => {
    let calls = 0;
    const harness = harnessWithDetails(() => {
      calls++;
      return Promise.resolve("text");
    });
    harness.setBatches([
      {
        jobs: Array.from({ length: 25 }, (_, index) =>
          makeJob(String(index), { title: dialogflowTitle(index) }),
        ),
      },
    ]);

    const runId = await harness.refresh();

    expect(calls).toBe(20);
    expect(onlyResult(harness.db, runId).detailsFetched).toBe(20);
  });

  it("keeps the job, scored on its title, when a description request fails", async () => {
    const harness = harnessWithDetails(() => Promise.reject(new Error("HTTP 500")));
    harness.setBatches([{ jobs: [makeJob("1", { title: dialogflowTitle(1) })] }]);

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "ok",
      detailsFetched: 1,
      detailsFailed: 1,
    });
    expect(listJobs(harness.db, "acme")[0]).toMatchObject({
      descriptionSnippet: "",
      relevanceTier: "high",
    });
  });

  it("never requests a description again once a snippet is stored, and keeps scoring with it", async () => {
    let calls = 0;
    const harness = harnessWithDetails(() => {
      calls++;
      return Promise.resolve("Genesys and contact center experience");
    });
    const listing: FetchedJob = makeJob("1", { title: dialogflowTitle(1) });
    harness.setBatches([{ jobs: [listing] }, { jobs: [listing] }]);
    await harness.refresh();
    harness.clock.time = T2;

    await harness.refresh();

    expect(calls).toBe(1);
    expect(listJobs(harness.db, "acme")[0]).toMatchObject({
      descriptionSnippet: "Genesys and contact center experience",
      matchedKeywords: ["Dialogflow CX", "Genesys", "contact center"],
    });
  });
});

describe("refresh service: capped fetches", () => {
  const cappedOutcome = { complete: false, stopReason: "page-cap" } as const;

  it("closes jobs a page-capped fetch no longer returns once they are stale, and keeps recent ones", async () => {
    const harness = createHarness({});
    harness.setBatches([
      { jobs: [makeJob("1"), makeJob("2")] },
      { jobs: [makeJob("1"), makeJob("3")], outcome: cappedOutcome },
      { jobs: [makeJob("1")], outcome: cappedOutcome },
    ]);
    await harness.refresh();

    harness.clock.time = T2;
    await harness.refresh();
    expect(listJobs(harness.db, "acme").map((job) => [job.externalId, job.closedAt])).toEqual([
      ["1", null],
      ["2", null],
      ["3", null],
    ]);

    harness.clock.time = T_AFTER_STALE_WINDOW;
    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({ jobsClosed: 2, stopReason: "page-cap" });
    expect(listJobs(harness.db, "acme").map((job) => [job.externalId, job.closedAt])).toEqual([
      ["1", null],
      ["2", T_AFTER_STALE_WINDOW],
      ["3", T_AFTER_STALE_WINDOW],
    ]);
  });

  it("never closes stale jobs after an early stop, because jobs past the stop are not re-read", async () => {
    const harness = createHarness({});
    harness.setBatches([
      { jobs: [makeJob("1"), makeJob("2")] },
      { jobs: [makeJob("1")], outcome: { complete: false, stopReason: "known-ids" } },
    ]);
    await harness.refresh();
    harness.clock.time = T_AFTER_STALE_WINDOW;

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({ jobsClosed: 0, message: null });
    expect(listJobs(harness.db, "acme").every((job) => job.closedAt === null)).toBe(true);
  });

  it("does not close anything when a page-capped fetch returns no jobs", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: [makeJob("1")] }, { jobs: [], outcome: cappedOutcome }]);
    await harness.refresh();
    harness.clock.time = T_AFTER_STALE_WINDOW;

    await harness.refresh();

    expect(listJobs(harness.db, "acme")[0]?.closedAt).toBeNull();
  });

  it("says in the result message that the page cap was reached, so a too-small maxPages is visible", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: [makeJob("1")], outcome: cappedOutcome }]);

    const runId = await harness.refresh();

    expect(onlyResult(harness.db, runId)).toMatchObject({
      status: "ok",
      stopReason: "page-cap",
      message: PAGE_CAP_MESSAGE,
    });
  });
});

describe("refresh service: scoring from the whole description", () => {
  const boilerplate = "We are a Dialogflow CX, CCAI and virtual agent contact center company.";
  const filler = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      makeJob(`m${index}`, { title: `Marketing Manager ${index}`, description: boilerplate }),
    );

  it("finds a keyword that sits beyond the first 1000 characters of a long posting", async () => {
    const harness = createHarness({});
    const description = `<p>${"About the company and the benefits we offer. ".repeat(40)}</p><p>You will build Dialogflow CX, CCAI and virtual agent flows.</p>`;
    harness.setBatches([
      { jobs: [makeJob("1", { title: "Senior Software Engineer", description })] },
    ]);

    await harness.refresh();

    const [job] = listJobs(harness.db, "acme");
    expect(job?.descriptionSnippet.length).toBeGreaterThan(1000);
    expect(job).toMatchObject({
      relevanceTier: "medium",
      matchedKeywords: ["Dialogflow CX", "CCAI", "virtual agent"],
    });
  });

  it("scores company boilerplate as nothing, but keeps a title match", async () => {
    const harness = createHarness({});
    harness.setBatches([
      {
        jobs: [
          ...filler(10),
          makeJob("dev", { title: "Dialogflow CX Developer", description: boilerplate }),
        ],
      },
    ]);

    await harness.refresh();

    const byId = Object.fromEntries(
      listJobs(harness.db, "acme").map((job) => [job.externalId, job]),
    );
    expect(byId["m0"]).toMatchObject({ relevanceTier: "none", matchedKeywords: [] });
    expect(byId["dev"]?.relevanceTier).toBe("high");
  });

  it("does not treat shared wording as boilerplate on a small board", async () => {
    const harness = createHarness({});
    harness.setBatches([{ jobs: filler(5) }]);

    await harness.refresh();

    expect(listJobs(harness.db, "acme")[0]?.relevanceTier).toBe("medium");
  });

  it("counts jobs stored earlier, so a short incremental fetch still recognises boilerplate", async () => {
    const harness = createHarness({});
    harness.setBatches([
      { jobs: filler(10) },
      {
        jobs: [makeJob("m0", { title: "Marketing Manager 0", description: boilerplate })],
        outcome: { complete: false, stopReason: "known-ids" },
      },
    ]);
    await harness.refresh();
    harness.clock.time = T2;

    await harness.refresh();

    expect(listJobs(harness.db, "acme").find((job) => job.externalId === "m0")).toMatchObject({
      relevanceTier: "none",
    });
  });
});

describe("refresh service: aborted run", () => {
  it("publishes run-finished with status aborted when the run cannot start its work", async () => {
    const db = openDatabase(":memory:");
    const recipesDir = makeTempDir();
    writeRecipeFile(recipesDir, "acme");
    const service = createRefreshService({
      db,
      http: fakeHttp(() => {
        throw new Error("no network");
      }).client,
      adapters: { greenhouse: scriptedAdapter(() => ({ jobs: [] })) },
      recipesDir,
      loadProfile: () => {
        throw new Error("profile.json is broken");
      },
    });

    const started = service.startRefresh({ full: false });
    const received: RefreshEvent[] = [];
    service.events.subscribe(started.runId, (event) => received.push(event));

    await expect(started.done).rejects.toThrow("profile.json is broken");

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "run-finished", run: { status: "aborted" } });
    expect(service.getActiveRunId()).toBeNull();
  });
});
