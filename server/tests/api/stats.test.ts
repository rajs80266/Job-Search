import request from "supertest";
import { describe, expect, it } from "vitest";
import { recordCompanySuccess, upsertCompany } from "../../src/db/companies";
import { upsertJobStatus } from "../../src/db/job-status";
import { localDateString } from "../../src/lib/dates";
import type { NormalizedJob, Stats } from "../../src/types";
import { type TestApp, createTestApp, storeJob } from "../helpers";

const localNoon = (month: number, day: number): string =>
  new Date(2026, month - 1, day, 12, 0).toISOString();
const NOW = new Date(2026, 10, 23, 15, 0);
const BASELINE = localNoon(11, 1);
const LATEST = localNoon(11, 22);

function job(id: string, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id,
    companySlug: "acme",
    externalId: id,
    title: `Engineer ${id}`,
    url: `https://jobs.example/${id}`,
    locationRaw: "Pune, India",
    cities: ["Pune"],
    isIndia: true,
    isRemote: false,
    postedAt: null,
    firstSeenAt: BASELINE,
    lastSeenAt: LATEST,
    closedAt: null,
    descriptionSnippet: "",
    relevanceScore: 1,
    relevanceTier: "low",
    matchedKeywords: [],
    ...overrides,
  };
}

function seedCompany(test: TestApp, slug: string, name: string): void {
  upsertCompany(test.db, {
    slug,
    name,
    category: "cx-vendor",
    ats: "greenhouse",
    status: "verified",
  });
  recordCompanySuccess(test.db, slug, BASELINE);
  recordCompanySuccess(test.db, slug, LATEST);
}

async function getStats(test: TestApp): Promise<Stats> {
  const response = await request(test.app).get("/api/stats");
  expect(response.status).toBe(200);
  return response.body as Stats;
}

describe("GET /api/stats", () => {
  it("returns zeros and a full 30-day window for an empty database", async () => {
    const stats = await getStats(createTestApp({ now: () => NOW }));

    expect(stats.newPerDay).toHaveLength(30);
    expect(stats.newPerDay.at(-1)?.date).toBe(localDateString(NOW));
    expect(stats.newPerDay[0]?.date).toBe(localDateString(new Date(2026, 9, 25, 12)));
    expect(stats.newPerDay.every((day) => day.count === 0 && day.highOrMedium === 0)).toBe(true);
    expect(stats.perCompany).toEqual([]);
    expect(stats.funnel).toEqual({
      saved: 0,
      applied: 0,
      interviewing: 0,
      rejected: 0,
      ignored: 0,
    });
    expect(stats.tiers).toEqual({ high: 0, medium: 0, low: 0, none: 0 });
    expect(stats.lastRun).toBeNull();
  });

  it("counts new roles per local day, leaving out the baseline, closed and non-India jobs", async () => {
    const test = createTestApp({ now: () => NOW });
    seedCompany(test, "acme", "Acme");
    storeJob(test.db, job("baseline", { firstSeenAt: BASELINE }));
    storeJob(test.db, job("a", { firstSeenAt: localNoon(11, 20), relevanceTier: "high" }));
    storeJob(test.db, job("b", { firstSeenAt: localNoon(11, 20), relevanceTier: "none" }));
    storeJob(test.db, job("c", { firstSeenAt: LATEST, relevanceTier: "medium" }));
    storeJob(test.db, job("closed", { firstSeenAt: LATEST, closedAt: LATEST }));
    storeJob(test.db, job("abroad", { firstSeenAt: LATEST, isIndia: false }));

    const { newPerDay } = await getStats(test);

    const byDate = Object.fromEntries(newPerDay.map((day) => [day.date, day]));
    expect(byDate["2026-11-20"]).toEqual({ date: "2026-11-20", count: 2, highOrMedium: 1 });
    expect(byDate["2026-11-22"]).toEqual({ date: "2026-11-22", count: 1, highOrMedium: 1 });
    expect(newPerDay.reduce((total, day) => total + day.count, 0)).toBe(3);
  });

  it("ranks companies by high + medium jobs and counts open, new and tiers per company", async () => {
    const test = createTestApp({ now: () => NOW });
    seedCompany(test, "acme", "Acme");
    seedCompany(test, "beta", "Beta");
    seedCompany(test, "empty", "Empty");
    storeJob(test.db, job("a1", { relevanceTier: "medium" }));
    storeJob(test.db, job("a2", { relevanceTier: "low" }));
    storeJob(test.db, job("b1", { companySlug: "beta", relevanceTier: "high" }));
    storeJob(
      test.db,
      job("b2", { companySlug: "beta", relevanceTier: "medium", firstSeenAt: LATEST }),
    );
    storeJob(test.db, job("b3", { companySlug: "beta", relevanceTier: "high", closedAt: LATEST }));

    const stats = await getStats(test);

    expect(stats.perCompany).toEqual([
      { slug: "beta", name: "Beta", open: 2, new: 1, high: 1, medium: 1 },
      { slug: "acme", name: "Acme", open: 2, new: 0, high: 0, medium: 1 },
    ]);
    expect(stats.tiers).toEqual({ high: 1, medium: 2, low: 1, none: 0 });
  });

  it("builds the funnel from job statuses, including closed jobs, and skips cleared statuses", async () => {
    const test = createTestApp({ now: () => NOW });
    seedCompany(test, "acme", "Acme");
    for (const id of ["s1", "s2", "ap", "iv", "cleared", "gone"]) storeJob(test.db, job(id));
    storeJob(test.db, job("closed-applied", { closedAt: LATEST }));
    const at = LATEST;
    upsertJobStatus(test.db, "s1", { status: "saved" }, at);
    upsertJobStatus(test.db, "s2", { status: "saved" }, at);
    upsertJobStatus(test.db, "ap", { status: "applied" }, at);
    upsertJobStatus(test.db, "closed-applied", { status: "applied" }, at);
    upsertJobStatus(test.db, "iv", { status: "interviewing" }, at);
    upsertJobStatus(test.db, "gone", { status: "ignored" }, at);
    upsertJobStatus(test.db, "cleared", { status: null, notes: "just a note" }, at);

    const { funnel } = await getStats(test);

    expect(funnel).toEqual({ saved: 2, applied: 2, interviewing: 1, rejected: 0, ignored: 1 });
  });
});
