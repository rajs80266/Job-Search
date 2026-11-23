import { describe, expect, it } from "vitest";
import { getCompany, listCompanies, upsertCompany } from "../../src/db/companies";
import { openDatabase } from "../../src/db/connection";
import { getJobStatus, upsertJobStatus } from "../../src/db/job-status";
import { closeUnseenJobs, getJob, listJobs, upsertJob } from "../../src/db/jobs";
import { runMigrations } from "../../src/db/migrations";
import {
  abortRunningRuns,
  finishRun,
  getRunSummary,
  insertCompanyResult,
  listCompanyResults,
  startRun,
} from "../../src/db/refresh-runs";
import type { NormalizedJob, RefreshCompanyResult } from "../../src/types";

const recipe = {
  slug: "acme",
  name: "Acme",
  category: "cx-vendor",
  ats: "greenhouse",
  status: "verified",
} as const;

function makeStoredJob(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id: "job-1",
    companySlug: "acme",
    externalId: "1",
    title: "Engineer",
    url: "https://jobs.example/1",
    locationRaw: "Pune, India",
    cities: ["Pune"],
    isIndia: true,
    isRemote: false,
    postedAt: "2026-10-01T00:00:00.000Z",
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-01T00:00:00.000Z",
    closedAt: null,
    descriptionSnippet: "text",
    relevanceScore: 12,
    relevanceTier: "medium",
    matchedKeywords: ["IVR"],
    ...overrides,
  };
}

function setup() {
  const db = openDatabase(":memory:");
  upsertCompany(db, recipe);
  return db;
}

describe("migrations", () => {
  it("creates the schema once and records the version", () => {
    const db = openDatabase(":memory:");

    runMigrations(db);

    expect(db.pragma("user_version", { simple: true })).toBe(1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables.sort()).toEqual([
      "companies",
      "job_status",
      "jobs",
      "refresh_company_results",
      "refresh_runs",
    ]);
  });

  it("runs only the migrations that have not been applied", () => {
    const db = openDatabase(":memory:");

    runMigrations(db, [
      "CREATE TABLE ignored_already_applied (id INTEGER)",
      "CREATE TABLE added_later (id INTEGER)",
    ]);

    const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    expect(names).toContainEqual({ name: "added_later" });
    expect(names).not.toContainEqual({ name: "ignored_already_applied" });
    expect(db.pragma("user_version", { simple: true })).toBe(2);
  });
});

describe("companies", () => {
  it("upserts the recipe columns without resetting runtime state", () => {
    const db = setup();
    db.prepare(
      "UPDATE companies SET last_success_at = '2026-11-01', first_success_at = '2026-11-01'",
    ).run();

    upsertCompany(db, { ...recipe, name: "Acme Inc", status: "broken" });

    expect(getCompany(db, "acme")).toMatchObject({
      name: "Acme Inc",
      status: "broken",
      lastSuccessAt: "2026-11-01",
      firstSuccessAt: "2026-11-01",
    });
    expect(listCompanies(db)).toHaveLength(1);
  });
});

describe("jobs", () => {
  it("round-trips a job including arrays and booleans", () => {
    const db = setup();

    upsertJob(db, makeStoredJob());

    expect(getJob(db, "job-1")).toEqual(makeStoredJob());
  });

  it("keeps first_seen_at and an old posted_at on update, and reopens closed jobs", () => {
    const db = setup();
    upsertJob(db, makeStoredJob({ closedAt: null }));
    closeUnseenJobs(db, "acme", new Set(), "2026-11-02T00:00:00.000Z");

    upsertJob(
      db,
      makeStoredJob({
        title: "Senior Engineer",
        postedAt: null,
        firstSeenAt: "2026-11-05T00:00:00.000Z",
        lastSeenAt: "2026-11-05T00:00:00.000Z",
      }),
    );

    expect(listJobs(db, "acme")[0]).toMatchObject({
      title: "Senior Engineer",
      postedAt: "2026-10-01T00:00:00.000Z",
      firstSeenAt: "2026-11-01T00:00:00.000Z",
      lastSeenAt: "2026-11-05T00:00:00.000Z",
      closedAt: null,
    });
  });

  it("closes only open jobs that were not seen", () => {
    const db = setup();
    upsertJob(db, makeStoredJob({ id: "j1", externalId: "1" }));
    upsertJob(db, makeStoredJob({ id: "j2", externalId: "2" }));
    upsertJob(db, makeStoredJob({ id: "j3", externalId: "3" }));
    closeUnseenJobs(db, "acme", new Set(["1", "2"]), "2026-11-02T00:00:00.000Z");

    const closedCount = closeUnseenJobs(db, "acme", new Set(["1"]), "2026-11-03T00:00:00.000Z");

    expect(closedCount).toBe(1);
    expect(listJobs(db, "acme").map((job) => [job.externalId, job.closedAt])).toEqual([
      ["1", null],
      ["2", "2026-11-03T00:00:00.000Z"],
      ["3", "2026-11-02T00:00:00.000Z"],
    ]);
  });
});

describe("job status", () => {
  it("updates only the given fields and supports clearing", () => {
    const db = setup();
    upsertJob(db, makeStoredJob());

    upsertJobStatus(db, "job-1", { status: "saved" }, "t1");
    upsertJobStatus(db, "job-1", { notes: "ask about remote" }, "t2");
    expect(getJobStatus(db, "job-1")).toEqual({
      jobId: "job-1",
      status: "saved",
      notes: "ask about remote",
      updatedAt: "t2",
    });

    upsertJobStatus(db, "job-1", { status: null }, "t3");
    expect(getJobStatus(db, "job-1")).toMatchObject({ status: null, notes: "ask about remote" });

    upsertJobStatus(db, "job-1", { notes: "" }, "t4");
    expect(getJobStatus(db, "job-1")).toMatchObject({ status: null, notes: "" });
  });

  it("is removed together with its job", () => {
    const db = setup();
    upsertJob(db, makeStoredJob());
    upsertJobStatus(db, "job-1", { status: "applied" }, "t1");

    db.prepare("DELETE FROM jobs WHERE id = 'job-1'").run();

    expect(getJobStatus(db, "job-1")).toBeUndefined();
  });
});

describe("refresh runs", () => {
  const result = (overrides: Partial<RefreshCompanyResult>): RefreshCompanyResult => ({
    runId: 1,
    companySlug: "acme",
    status: "ok",
    mode: "incremental",
    startedAt: "2026-11-01T00:00:00.000Z",
    finishedAt: "2026-11-01T00:00:01.000Z",
    jobsFetched: 10,
    jobsNew: 2,
    jobsClosed: 1,
    jobsInvalid: 0,
    pagesFetched: 1,
    detailsFetched: 0,
    detailsFailed: 0,
    stopReason: "end",
    message: null,
    ...overrides,
  });

  it("computes run totals from the company results", () => {
    const db = setup();
    const runId = startRun(db, {
      companySlug: null,
      full: true,
      startedAt: "2026-11-01T00:00:00.000Z",
    });
    insertCompanyResult(db, result({ runId }));
    insertCompanyResult(
      db,
      result({
        runId,
        companySlug: "beta",
        status: "failed",
        jobsNew: 0,
        jobsClosed: 0,
        message: "boom",
        stopReason: null,
      }),
    );
    insertCompanyResult(
      db,
      result({ runId, companySlug: "gamma", status: "skipped", jobsNew: 0, jobsClosed: 0 }),
    );
    finishRun(db, runId, "finished", "2026-11-01T00:01:00.000Z");

    expect(getRunSummary(db, runId)).toEqual({
      id: runId,
      startedAt: "2026-11-01T00:00:00.000Z",
      finishedAt: "2026-11-01T00:01:00.000Z",
      status: "finished",
      companySlug: null,
      full: true,
      totals: { companies: 3, ok: 1, failed: 1, skipped: 1, jobsNew: 2, jobsClosed: 1 },
    });
    expect(listCompanyResults(db, runId).map((row) => row.companySlug)).toEqual([
      "acme",
      "beta",
      "gamma",
    ]);
  });

  it("reports zero totals for a run without results", () => {
    const db = setup();
    const runId = startRun(db, { companySlug: "acme", full: false, startedAt: "t" });

    expect(getRunSummary(db, runId)?.totals).toEqual({
      companies: 0,
      ok: 0,
      failed: 0,
      skipped: 0,
      jobsNew: 0,
      jobsClosed: 0,
    });
    expect(getRunSummary(db, 999)).toBeUndefined();
  });

  it("marks runs left running as aborted", () => {
    const db = setup();
    const stale = startRun(db, { companySlug: null, full: false, startedAt: "t1" });
    const done = startRun(db, { companySlug: null, full: false, startedAt: "t2" });
    finishRun(db, done, "finished", "t3");

    expect(abortRunningRuns(db, "t4")).toBe(1);

    expect(getRunSummary(db, stale)).toMatchObject({ status: "aborted", finishedAt: "t4" });
    expect(getRunSummary(db, done)?.status).toBe("finished");
  });
});
