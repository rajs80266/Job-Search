import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { recordCompanySuccess, upsertCompany } from "../../src/db/companies";
import { upsertJobStatus } from "../../src/db/job-status";
import type { JobListItem, NormalizedJob, Page } from "../../src/types";
import { type TestApp, createTestApp, storeJob } from "../helpers";

const BASELINE = "2026-11-01T00:00:00.000Z";
const LATEST = "2026-11-10T00:00:00.000Z";

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
    postedAt: "2026-11-05T00:00:00.000Z",
    firstSeenAt: BASELINE,
    lastSeenAt: LATEST,
    closedAt: null,
    descriptionSnippet: "",
    relevanceScore: 10,
    relevanceTier: "medium",
    matchedKeywords: ["Dialogflow CX"],
    ...overrides,
  };
}

function seedCompany(
  { db }: TestApp,
  slug: string,
  category: "cx-vendor" | "bpo",
  name = slug.toUpperCase(),
) {
  upsertCompany(db, { slug, name, category, ats: "greenhouse", status: "verified" });
  recordCompanySuccess(db, slug, BASELINE);
  recordCompanySuccess(db, slug, LATEST);
}

async function listJobs(test: TestApp, query = ""): Promise<Page<JobListItem>> {
  const response = await request(test.app).get(`/api/jobs${query}`);
  expect(response.status).toBe(200);
  return response.body as Page<JobListItem>;
}

const ids = (page: Page<JobListItem>): string[] => page.items.map((item) => item.id);

describe("GET /api/jobs", () => {
  let test: TestApp;

  beforeEach(() => {
    test = createTestApp();
    seedCompany(test, "acme", "cx-vendor", "Acme Corp");
    seedCompany(test, "bpo1", "bpo", "Big BPO");
  });

  it("returns open India jobs by default, best score first, with company and status info", async () => {
    storeJob(test.db, job("low", { relevanceScore: 5, relevanceTier: "low" }));
    storeJob(test.db, job("top", { relevanceScore: 24, relevanceTier: "high" }));
    storeJob(test.db, job("abroad", { isIndia: false }));
    storeJob(test.db, job("closed", { closedAt: LATEST }));
    storeJob(test.db, job("ignored"));
    upsertJobStatus(test.db, "ignored", { status: "ignored" }, LATEST);

    const page = await listJobs(test);

    expect(ids(page)).toEqual(["top", "low"]);
    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 50 });
    expect(page.items[0]).toMatchObject({
      companyName: "Acme Corp",
      category: "cx-vendor",
      status: null,
      notes: "",
      statusUpdatedAt: null,
      matchedKeywords: ["Dialogflow CX"],
      cities: ["Pune"],
    });
  });

  it("filters by search text without treating % and _ as wildcards", async () => {
    storeJob(test.db, job("a", { title: "Dialogflow CX Developer" }));
    storeJob(test.db, job("b", { title: "Backend Engineer", descriptionSnippet: "100% remote" }));
    storeJob(test.db, job("c", { title: "Cloud Engineer" }));

    expect(ids(await listJobs(test, "?q=dialogflow"))).toEqual(["a"]);
    expect(ids(await listJobs(test, "?q=100%25"))).toEqual(["b"]);
    expect(ids(await listJobs(test, "?q=big%20bpo"))).toEqual([]);
    expect((await listJobs(test, "?q=%25")).total).toBe(1);
  });

  it("filters by company, category, tier list and city", async () => {
    storeJob(test.db, job("a", { relevanceTier: "high", relevanceScore: 20 }));
    storeJob(
      test.db,
      job("b", { companySlug: "bpo1", cities: ["Mumbai", "Remote"], relevanceTier: "low" }),
    );

    expect(ids(await listJobs(test, "?company=bpo1"))).toEqual(["b"]);
    expect(ids(await listJobs(test, "?company=acme,bpo1"))).toHaveLength(2);
    expect(ids(await listJobs(test, "?category=cx-vendor"))).toEqual(["a"]);
    expect(ids(await listJobs(test, "?tier=high,low"))).toEqual(["a", "b"]);
    expect(ids(await listJobs(test, "?tier=medium"))).toEqual([]);
    expect(ids(await listJobs(test, "?city=Mumbai"))).toEqual(["b"]);
  });

  it("filters by status: hides ignored by default, none, and a specific status", async () => {
    storeJob(test.db, job("a"));
    storeJob(test.db, job("b"));
    storeJob(test.db, job("c"));
    upsertJobStatus(test.db, "b", { status: "saved" }, LATEST);
    upsertJobStatus(test.db, "c", { status: "ignored" }, LATEST);

    expect(ids(await listJobs(test, "?sort=firstSeen"))).toEqual(["a", "b"]);
    expect(ids(await listJobs(test, "?status=none"))).toEqual(["a"]);
    expect(ids(await listJobs(test, "?status=saved"))).toEqual(["b"]);
    expect(ids(await listJobs(test, "?status=ignored"))).toEqual(["c"]);
  });

  it("marks only jobs first seen in the latest fetch as new; the baseline fetch marks nothing", async () => {
    storeJob(test.db, job("old", { firstSeenAt: BASELINE }));
    storeJob(test.db, job("fresh", { firstSeenAt: LATEST }));
    seedCompany(test, "baseline-only", "bpo");
    test.db
      .prepare("UPDATE companies SET last_success_at = ?, first_success_at = ? WHERE slug = ?")
      .run(BASELINE, BASELINE, "baseline-only");
    storeJob(test.db, job("b1", { companySlug: "baseline-only", firstSeenAt: BASELINE }));

    const everything = await listJobs(test, "?sort=firstSeen");
    expect(Object.fromEntries(everything.items.map((item) => [item.id, item.isNew]))).toEqual({
      fresh: true,
      old: false,
      b1: false,
    });
    expect(ids(await listJobs(test, "?isNew=true"))).toEqual(["fresh"]);
    expect(ids(await listJobs(test, "?isNew=false&sort=firstSeen"))).toEqual(["b1", "old"]);
  });

  it("filters india and remote, and includes closed jobs on request", async () => {
    storeJob(test.db, job("in"));
    storeJob(test.db, job("out", { isIndia: false }));
    storeJob(test.db, job("remote", { isRemote: true, cities: ["Remote"] }));
    storeJob(test.db, job("closed", { closedAt: LATEST }));

    expect((await listJobs(test, "?india=all&sort=firstSeen")).total).toBe(3);
    expect(ids(await listJobs(test, "?india=false"))).toEqual(["out"]);
    expect(ids(await listJobs(test, "?remote=true"))).toEqual(["remote"]);
    expect((await listJobs(test, "?includeClosed=true")).total).toBe(3);
  });

  it("sorts by posted date with unknown dates last, and by first seen", async () => {
    storeJob(test.db, job("older", { postedAt: "2026-11-01T00:00:00.000Z" }));
    storeJob(test.db, job("newer", { postedAt: "2026-11-09T00:00:00.000Z" }));
    storeJob(test.db, job("undated", { postedAt: null }));
    storeJob(test.db, job("seen-last", { firstSeenAt: LATEST }));

    expect(ids(await listJobs(test, "?sort=posted")).slice(0, 3)).toEqual([
      "newer",
      "seen-last",
      "older",
    ]);
    expect(ids(await listJobs(test, "?sort=posted")).at(-1)).toBe("undated");
    expect(ids(await listJobs(test, "?sort=firstSeen"))[0]).toBe("seen-last");
  });

  it("pages results and reports the total", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) storeJob(test.db, job(id));

    const second = await listJobs(test, "?pageSize=2&page=2");

    expect(ids(second)).toEqual(["c", "d"]);
    expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect((await listJobs(test, "?pageSize=2&page=9")).items).toEqual([]);
  });

  it.each(["tier=urgent", "pageSize=500", "page=0", "sort=random", "isNew=maybe", "company="])(
    "rejects invalid query %s with a validation error",
    async (query) => {
      const response = await request(test.app).get(`/api/jobs?${query}`);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "validation" });
    },
  );
});

describe("PATCH /api/jobs/:id/status", () => {
  let test: TestApp;
  const now = new Date("2026-11-12T08:00:00.000Z");

  beforeEach(() => {
    test = createTestApp({ now: () => now });
    seedCompany(test, "acme", "cx-vendor");
    storeJob(test.db, job("a"));
  });

  const patch = (id: string, body: unknown) =>
    request(test.app)
      .patch(`/api/jobs/${id}/status`)
      .send(body as object);

  it("sets a status and notes, and the job list reflects them", async () => {
    const response = await patch("a", { status: "applied", notes: "Referred by Priya" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobId: "a",
      status: "applied",
      notes: "Referred by Priya",
      updatedAt: now.toISOString(),
    });
    const [item] = (await listJobs(test)).items;
    expect(item).toMatchObject({ status: "applied", notes: "Referred by Priya" });
  });

  it("changes only the field that is sent, and null clears the status", async () => {
    await patch("a", { status: "saved", notes: "keep" });

    expect((await patch("a", { notes: "updated" })).body).toMatchObject({
      status: "saved",
      notes: "updated",
    });
    expect((await patch("a", { status: null })).body).toMatchObject({
      status: null,
      notes: "updated",
    });
    expect((await patch("a", { notes: "" })).body).toMatchObject({ status: null, notes: "" });
  });

  it("returns 404 for an unknown job", async () => {
    const response = await patch("missing", { status: "saved" });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "not-found" });
  });

  it.each([{}, { status: "dreaming" }, { notes: 5 }, { notes: "x".repeat(5001) }])(
    "rejects an invalid body %j",
    async (body) => {
      const response = await patch("a", body);

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ error: "validation" });
    },
  );

  it("rejects a body that is not JSON", async () => {
    const response = await request(test.app)
      .patch("/api/jobs/a/status")
      .set("content-type", "text/plain")
      .send("status=saved");

    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await request(test.app)
      .patch("/api/jobs/a/status")
      .set("content-type", "application/json")
      .send("{not json");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "validation" });
  });
});
