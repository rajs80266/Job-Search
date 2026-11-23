import request from "supertest";
import { describe, expect, it } from "vitest";
import { recordCompanySuccess } from "../../src/db/companies";
import { syncCompanies } from "../../src/recipes/store";
import type { CompanyList, NormalizedJob, Profile } from "../../src/types";
import { createTestApp, storeJob, testProfile, writeRecipeFile } from "../helpers";

describe("local-only guards", () => {
  it("rejects requests for another host name", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/health").set("Host", "evil.example");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: "forbidden" });
  });

  it("accepts localhost", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/health").set("Host", "localhost:5174");

    expect(response.status).toBe(200);
  });

  it("requires a JSON content type on writes, even without a body", async () => {
    const { app } = createTestApp();

    const response = await request(app).post("/api/refresh");

    expect(response.status).toBe(400);
  });

  it("answers unknown API routes with a JSON 404", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/nope");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: "not-found" });
  });
});

describe("GET /api/profile", () => {
  it("returns the profile", async () => {
    const { app } = createTestApp();

    const response = await request(app).get("/api/profile");

    expect(response.status).toBe(200);
    const profile = response.body as Profile;
    expect(profile.candidate.preferredCities).toEqual(testProfile.candidate.preferredCities);
    expect(profile.cities.length).toBe(testProfile.cities.length);
  });
});

describe("GET /api/companies", () => {
  it("lists recipes with runtime state and open India job counts", async () => {
    const test = createTestApp({ slugs: ["acme", "beta"] });
    writeRecipeFile(test.recipesDir, "gamma", {
      status: "needs-manual",
      ats: "manual",
      fetch: undefined,
      verifiedOn: undefined,
      manualSearchUrl: "https://gamma.example/search",
      notes: "no public API",
    });
    writeRecipeFile(test.recipesDir, "broken-file", { status: "verified", verifiedOn: undefined });
    syncCompanies(test.db, test.recipesDir);
    recordCompanySuccess(test.db, "acme", "2026-11-01T00:00:00.000Z");
    recordCompanySuccess(test.db, "acme", "2026-11-10T00:00:00.000Z");
    const base: NormalizedJob = {
      id: "j1",
      companySlug: "acme",
      externalId: "1",
      title: "Engineer",
      url: "https://jobs.example/1",
      locationRaw: "Pune",
      cities: ["Pune"],
      isIndia: true,
      isRemote: false,
      postedAt: null,
      firstSeenAt: "2026-11-10T00:00:00.000Z",
      lastSeenAt: "2026-11-10T00:00:00.000Z",
      closedAt: null,
      descriptionSnippet: "",
      relevanceScore: 1,
      relevanceTier: "low",
      matchedKeywords: [],
    };
    storeJob(test.db, base);
    storeJob(test.db, {
      ...base,
      id: "j2",
      externalId: "2",
      firstSeenAt: "2026-11-01T00:00:00.000Z",
    });
    storeJob(test.db, { ...base, id: "j3", externalId: "3", isIndia: false });
    storeJob(test.db, {
      ...base,
      id: "j4",
      externalId: "4",
      closedAt: "2026-11-10T00:00:00.000Z",
    });

    const response = await request(test.app).get("/api/companies");

    expect(response.status).toBe(200);
    const list = response.body as CompanyList;
    expect(list.companies.map((company) => company.recipe.slug)).toEqual(["acme", "beta", "gamma"]);
    expect(list.invalidFiles.map((file) => file.file)).toEqual(["broken-file.json"]);
    const [acme, beta, gamma] = list.companies;
    expect(acme?.runtime).toMatchObject({
      lastSuccessAt: "2026-11-10T00:00:00.000Z",
      lastRefreshError: null,
      openJobs: 2,
      newJobs: 1,
    });
    expect(beta?.runtime).toEqual({
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastRefreshError: null,
      openJobs: 0,
      newJobs: 0,
    });
    expect(gamma?.recipe.status).toBe("needs-manual");
  });
});
