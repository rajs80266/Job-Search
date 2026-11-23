import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { recordCompanySuccess } from "../../src/db/companies";
import { upsertJobStatus } from "../../src/db/job-status";
import { getCompany } from "../../src/db/companies";
import { syncCompanies } from "../../src/recipes/store";
import type {
  CompanySummary,
  ImportCurlResponse,
  NormalizedJob,
  VerifyResult,
} from "../../src/types";
import {
  type TestApp,
  createTestApp,
  fakeHttp,
  makeJob,
  readFixture,
  recipeInput,
  scriptedAdapter,
  storeJob,
} from "../helpers";

const newCompany = (slug: string, overrides: Record<string, unknown> = {}) =>
  recipeInput(slug, { status: "unverified", verifiedOn: undefined, ...overrides });

const fileOf = (test: TestApp, slug: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(test.recipesDir, `${slug}.json`), "utf8")) as Record<
    string,
    unknown
  >;

function storedJob(slug: string, id: string): NormalizedJob {
  return {
    id,
    companySlug: slug,
    externalId: id,
    title: "Engineer",
    url: "https://jobs.example/1",
    locationRaw: "Pune",
    cities: ["Pune"],
    isIndia: true,
    isRemote: false,
    postedAt: null,
    firstSeenAt: "2026-11-01T00:00:00.000Z",
    lastSeenAt: "2026-11-01T00:00:00.000Z",
    closedAt: null,
    descriptionSnippet: "",
    relevanceScore: 1,
    relevanceTier: "low",
    matchedKeywords: [],
  };
}

describe("POST /api/companies", () => {
  it("creates an unverified recipe file and returns the summary", async () => {
    const test = createTestApp({ slugs: [] });

    const response = await request(test.app).post("/api/companies").send(newCompany("newco"));

    expect(response.status).toBe(201);
    const summary = response.body as CompanySummary;
    expect(summary.recipe).toMatchObject({ slug: "newco", status: "unverified" });
    expect(summary.runtime).toMatchObject({ openJobs: 0, lastSuccessAt: null });
    expect(fileOf(test, "newco")).toMatchObject({ slug: "newco", status: "unverified" });
    expect(getCompany(test.db, "newco")?.status).toBe("unverified");
  });

  it("returns 409 for an existing slug and leaves the file alone", async () => {
    const test = createTestApp({ slugs: ["acme"] });

    const response = await request(test.app)
      .post("/api/companies")
      .send(newCompany("acme", { name: "Changed" }));

    expect(response.status).toBe(409);
    expect(fileOf(test, "acme")).toMatchObject({ name: "ACME" });
  });

  it.each([
    ["a verified new company", { status: "verified" }],
    ["a credential header", { fetch: { url: "https://x.example/a", headers: { Cookie: "a=b" } } }],
    ["a bad slug", { slug: "Bad Slug" }],
  ])("rejects %s", async (_name, overrides) => {
    const test = createTestApp({ slugs: [] });

    const response = await request(test.app)
      .post("/api/companies")
      .send(newCompany("newco", overrides));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "validation" });
    expect(existsSync(path.join(test.recipesDir, "newco.json"))).toBe(false);
  });
});

describe("PUT /api/companies/:slug", () => {
  const put = (test: TestApp, slug: string, body: unknown) =>
    request(test.app)
      .put(`/api/companies/${slug}`)
      .send(body as object);

  it("keeps the verification when only notes change", async () => {
    const test = createTestApp();

    const response = await put(test, "acme", recipeInput("acme", { notes: "hello" }));

    expect(response.status).toBe(200);
    expect((response.body as CompanySummary).recipe).toMatchObject({
      status: "verified",
      verifiedOn: "2026-11-01",
      notes: "hello",
    });
    expect(fileOf(test, "acme")).toMatchObject({ notes: "hello", verifiedOn: "2026-11-01" });
  });

  it("resets to unverified when the integration changes", async () => {
    const test = createTestApp();

    const response = await put(
      test,
      "acme",
      recipeInput("acme", {
        fetch: { url: "https://boards-api.greenhouse.io/v1/boards/other/jobs" },
      }),
    );

    const file = fileOf(test, "acme");
    expect(file.status).toBe("unverified");
    expect(file).not.toHaveProperty("verifiedOn");
    expect((response.body as CompanySummary).recipe.status).toBe("unverified");
  });

  it("disables and re-enables, and mirrors the status into the database", async () => {
    const test = createTestApp();

    await put(test, "acme", recipeInput("acme", { status: "disabled" }));
    expect(getCompany(test.db, "acme")?.status).toBe("disabled");
    expect(fileOf(test, "acme")).toMatchObject({ status: "disabled", verifiedOn: "2026-11-01" });

    await put(test, "acme", recipeInput("acme", { status: "unverified" }));
    expect(getCompany(test.db, "acme")?.status).toBe("unverified");
    expect(fileOf(test, "acme")).not.toHaveProperty("verifiedOn");
  });

  it("ignores proof sent by the client", async () => {
    const test = createTestApp();
    await put(test, "acme", recipeInput("acme", { status: "unverified" }));

    await put(test, "acme", recipeInput("acme", { status: "verified", verifiedOn: "2030-01-01" }));

    expect(fileOf(test, "acme")).toMatchObject({ status: "unverified" });
    expect(fileOf(test, "acme")).not.toHaveProperty("verifiedOn");
  });

  it("returns 400 for a slug mismatch, 404 for an unknown company", async () => {
    const test = createTestApp();

    expect((await put(test, "acme", recipeInput("other"))).status).toBe(400);
    expect((await put(test, "nope", recipeInput("nope"))).status).toBe(404);
  });
});

const deleteCompany = (test: TestApp, slug: string) =>
  request(test.app).delete(`/api/companies/${slug}`).set("content-type", "application/json");

describe("DELETE /api/companies/:slug", () => {
  it("deletes the file, the row and its jobs", async () => {
    const test = createTestApp();
    syncCompanies(test.db, test.recipesDir);
    storeJob(test.db, storedJob("acme", "j1"));

    const response = await deleteCompany(test, "acme");

    expect(response.status).toBe(204);
    expect(existsSync(path.join(test.recipesDir, "acme.json"))).toBe(false);
    expect(getCompany(test.db, "acme")).toBeUndefined();
    expect(test.db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
  });

  it.each([
    ["a status", { status: "saved" as const }],
    ["notes", { notes: "call Monday" }],
  ])("is blocked with 409 when a job has %s", async (_name, update) => {
    const test = createTestApp();
    syncCompanies(test.db, test.recipesDir);
    storeJob(test.db, storedJob("acme", "j1"));
    upsertJobStatus(test.db, "j1", update, "2026-11-02T00:00:00.000Z");

    const response = await deleteCompany(test, "acme");

    expect(response.status).toBe(409);
    expect(existsSync(path.join(test.recipesDir, "acme.json"))).toBe(true);
  });

  it("is not blocked by a cleared status with empty notes, and returns 404 when unknown", async () => {
    const test = createTestApp();
    syncCompanies(test.db, test.recipesDir);
    storeJob(test.db, storedJob("acme", "j1"));
    upsertJobStatus(test.db, "j1", { status: null, notes: "" }, "2026-11-02T00:00:00.000Z");

    expect((await deleteCompany(test, "acme")).status).toBe(204);
    expect((await deleteCompany(test, "acme")).status).toBe(404);
  });
});

describe("POST /api/companies/:slug/verify", () => {
  const adapterWithJobs = scriptedAdapter(() => ({ jobs: [makeJob("1"), makeJob("2")] }));
  const failingAdapter = scriptedAdapter(() => ({ error: new Error("HTTP 503") }));

  it("verifies the stored recipe and writes the outcome to its file", async () => {
    const test = createTestApp({ adapter: adapterWithJobs });
    await request(test.app)
      .put("/api/companies/acme")
      .send(recipeInput("acme", { status: "unverified" }));

    const response = await request(test.app).post("/api/companies/acme/verify").send({});

    expect(response.status).toBe(200);
    expect(response.body as VerifyResult).toMatchObject({
      ok: true,
      jobCount: 2,
      saved: true,
      sampleTitles: ["Engineer 1", "Engineer 2"],
    });
    expect(fileOf(test, "acme")).toMatchObject({ status: "verified" });
    expect(getCompany(test.db, "acme")?.status).toBe("verified");
  });

  it("records a failure: a verified recipe becomes broken, an unverified one stays unverified", async () => {
    const test = createTestApp({ adapter: failingAdapter, slugs: ["acme", "fresh"] });
    await request(test.app)
      .put("/api/companies/fresh")
      .send(recipeInput("fresh", { status: "unverified" }));

    const broken = await request(test.app).post("/api/companies/acme/verify").send({});
    const stillUnverified = await request(test.app).post("/api/companies/fresh/verify").send({});

    expect(broken.body).toMatchObject({ ok: false, error: "HTTP 503", saved: true });
    expect(fileOf(test, "acme")).toMatchObject({ status: "broken", lastError: "HTTP 503" });
    expect(stillUnverified.body).toMatchObject({ ok: false });
    expect(fileOf(test, "fresh")).toMatchObject({ status: "unverified", lastError: "HTTP 503" });
  });

  it("tests a recipe from the body as a dry run: nothing is written", async () => {
    const test = createTestApp({ adapter: adapterWithJobs, slugs: [] });

    const response = await request(test.app)
      .post("/api/companies/newco/verify")
      .send({ recipe: newCompany("newco") });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, jobCount: 2, saved: false });
    expect(existsSync(path.join(test.recipesDir, "newco.json"))).toBe(false);
  });

  it("returns 400 for a body recipe with another slug or an invalid recipe", async () => {
    const test = createTestApp({ adapter: adapterWithJobs, slugs: [] });

    const mismatch = await request(test.app)
      .post("/api/companies/other/verify")
      .send({ recipe: newCompany("newco") });
    const invalid = await request(test.app)
      .post("/api/companies/newco/verify")
      .send({ recipe: { slug: "newco" } });

    expect(mismatch.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("returns 404 for an unknown company and 409 for a needs-manual one", async () => {
    const test = createTestApp();
    await request(test.app)
      .put("/api/companies/acme")
      .send(
        recipeInput("acme", {
          status: "needs-manual",
          manualSearchUrl: "https://acme.example/search",
          notes: "no public API",
        }),
      );

    expect((await request(test.app).post("/api/companies/nope/verify").send({})).status).toBe(404);
    expect((await request(test.app).post("/api/companies/acme/verify").send({})).status).toBe(409);
  });
});

describe("POST /api/companies/import-curl", () => {
  const importCurl = (test: TestApp, body: unknown) =>
    request(test.app)
      .post("/api/companies/import-curl")
      .send(body as object);

  it("turns a pasted cURL into a draft without touching the network or any file", async () => {
    const { client, requests } = fakeHttp(() => {
      throw new Error("import must not use the network");
    });
    const test = createTestApp({ slugs: [], http: client });

    const response = await importCurl(test, {
      text: readFixture("curl/workday-bash.txt"),
      name: "Acme",
      category: "cx-vendor",
    });

    expect(response.status).toBe(200);
    const body = response.body as ImportCurlResponse;
    expect(body.detectedAts).toBe("workday");
    expect(body.draft).toMatchObject({
      name: "Acme",
      category: "cx-vendor",
      ats: "workday",
      status: "unverified",
      careersUrl: "https://acme.wd3.myworkdayjobs.com/External",
      fetch: {
        url: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { limit: 20 },
      },
    });
    expect(body.strippedHeaders).toContain("cookie");
    expect(body.warnings).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/SECRET|PLAY_SESSION/);
    expect(requests).toHaveLength(0);
  });

  it("falls back to the generic adapter with a warning when no ATS matches", async () => {
    const test = createTestApp({ slugs: [] });

    const response = await importCurl(test, { text: readFixture("curl/generic-ansi.txt") });

    const body = response.body as ImportCurlResponse;
    expect(body.detectedAts).toBeNull();
    expect(body.draft.ats).toBe("generic");
    expect(body.warnings.join(" ")).toContain("fieldMap");
  });

  it("returns 400 for text that is not a request", async () => {
    const test = createTestApp({ slugs: [] });

    const garbage = await importCurl(test, { text: "hello" });
    const empty = await importCurl(test, { text: "" });

    expect(garbage.status).toBe(400);
    expect(garbage.body).toMatchObject({ error: "validation" });
    expect(empty.status).toBe(400);
  });
});

describe("GET /api/companies/:slug", () => {
  it("returns one summary with its runtime counts, and 404 for an unknown slug", async () => {
    const test = createTestApp();
    syncCompanies(test.db, test.recipesDir);
    recordCompanySuccess(test.db, "acme", "2026-11-01T00:00:00.000Z");
    storeJob(test.db, storedJob("acme", "j1"));

    const response = await request(test.app).get("/api/companies/acme");

    expect(response.status).toBe(200);
    expect((response.body as CompanySummary).runtime).toMatchObject({ openJobs: 1 });
    expect((await request(test.app).get("/api/companies/nope")).status).toBe(404);
  });
});

describe("slug path traversal", () => {
  const encodedEscape = "..%2Fescape-target";

  it.each([
    ["GET", (test: TestApp) => request(test.app).get(`/api/companies/${encodedEscape}`)],
    ["DELETE", (test: TestApp) => deleteCompany(test, encodedEscape)],
    [
      "POST verify",
      (test: TestApp) =>
        request(test.app)
          .post(`/api/companies/${encodedEscape}/verify`)
          .set("content-type", "application/json")
          .send({}),
    ],
  ])("%s with an escaping slug returns 400 and touches no file", async (_name, send) => {
    const test = createTestApp();
    const outside = path.join(path.dirname(test.recipesDir), "escape-target.json");
    writeFileSync(outside, "{}");

    const response = await send(test);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "validation" });
    expect(existsSync(outside)).toBe(true);
    rmSync(outside);
  });
});
