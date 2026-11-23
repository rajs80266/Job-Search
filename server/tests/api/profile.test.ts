import request from "supertest";
import { describe, expect, it } from "vitest";
import { recordCompanySuccess, upsertCompany } from "../../src/db/companies";
import { queryJobs } from "../../src/db/job-queries";
import type { Adapter, NormalizedJob, Profile, ProfileSaveResponse } from "../../src/types";
import { JobsQuerySchema } from "../../src/types";
import {
  type TestApp,
  createTestApp,
  makeJob,
  storeJob,
  testProfile,
  writeRecipeFile,
} from "../helpers";

const AT = "2026-11-01T00:00:00.000Z";

/** Stored values are deliberately stale ("none", score 0) so a re-score has something to change. */
function staleJob(
  id: string,
  title: string,
  overrides: Partial<NormalizedJob> = {},
): NormalizedJob {
  return {
    id,
    companySlug: "acme",
    externalId: id,
    title,
    url: `https://jobs.example/${id}`,
    locationRaw: "Pune, India",
    cities: [],
    isIndia: true,
    isRemote: false,
    postedAt: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    closedAt: null,
    descriptionSnippet: "",
    relevanceScore: 0,
    relevanceTier: "none",
    matchedKeywords: [],
    ...overrides,
  };
}

function seed(test: TestApp): void {
  upsertCompany(test.db, {
    slug: "acme",
    name: "Acme",
    category: "cx-vendor",
    ats: "greenhouse",
    status: "verified",
  });
  recordCompanySuccess(test.db, "acme", AT);
  storeJob(test.db, staleJob("dev", "Dialogflow CX Developer"));
  storeJob(test.db, staleJob("acct", "Accountant"));
  storeJob(
    test.db,
    staleJob("london", "Chatbot Developer", { locationRaw: "London, United Kingdom" }),
  );
}

const put = (test: TestApp, body: unknown, query = "") =>
  request(test.app)
    .put(`/api/profile${query}`)
    .send(body as object);

const storedTier = (test: TestApp, id: string): string =>
  (
    test.db.prepare("SELECT relevance_tier AS tier FROM jobs WHERE id = ?").get(id) as {
      tier: string;
    }
  ).tier;

describe("PUT /api/profile?dryRun=true", () => {
  it("reports tier counts before and after without changing jobs or the profile file", async () => {
    const test = createTestApp();
    seed(test);

    const response = await put(test, testProfile, "?dryRun=true");

    expect(response.status).toBe(200);
    expect(response.body as ProfileSaveResponse).toEqual({
      saved: false,
      rescored: 3,
      before: { high: 0, medium: 0, low: 0, none: 3 },
      after: { high: 1, medium: 0, low: 0, none: 1 },
    });
    expect(storedTier(test, "dev")).toBe("none");
    expect(test.savedProfiles).toEqual([]);
  });

  it("shows what a changed weight does", async () => {
    const test = createTestApp();
    seed(test);
    const stricter: Profile = { ...testProfile, tiers: { high: 40, medium: 20, low: 4 } };

    const response = await put(test, stricter, "?dryRun=true");

    expect((response.body as ProfileSaveResponse).after).toEqual({
      high: 0,
      medium: 0,
      low: 1,
      none: 1,
    });
  });

  it("is allowed while a refresh is running", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Adapter = {
      ats: "greenhouse",
      async *fetchJobs() {
        await gate;
        yield makeJob("1");
        return { complete: true, stopReason: "end", pagesFetched: 1 };
      },
    };
    const test = createTestApp({ adapter: slow });
    await request(test.app).post("/api/refresh").send({});

    const dryRun = await put(test, testProfile, "?dryRun=true");
    release();

    expect(dryRun.status).toBe(200);
  });
});

describe("PUT /api/profile", () => {
  it("re-scores every stored job, saves the profile and the Jobs list shows the new tiers", async () => {
    const test = createTestApp();
    seed(test);

    const response = await put(test, testProfile);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ saved: true, rescored: 3 });
    expect(test.savedProfiles).toHaveLength(1);
    expect(storedTier(test, "dev")).toBe("high");
    expect(storedTier(test, "acct")).toBe("none");
    const page = queryJobs(test.db, JobsQuerySchema.parse({ tier: "high" }));
    expect(page.items.map((item) => item.id)).toEqual(["dev"]);
    expect(page.items[0]).toMatchObject({ matchedKeywords: ["Dialogflow CX"], cities: ["Pune"] });
  });

  it("re-classifies India from the stored location text", async () => {
    const test = createTestApp();
    seed(test);

    await put(test, testProfile);

    const row = test.db
      .prepare("SELECT is_india AS isIndia FROM jobs WHERE id = 'london'")
      .get() as {
      isIndia: number;
    };
    expect(row.isIndia).toBe(0);
  });

  it("treats a recipe with indiaFiltered as India even when the location is blank", async () => {
    const test = createTestApp({ slugs: [] });
    writeRecipeFile(test.recipesDir, "acme", {
      filters: { keywords: [], indiaFiltered: true },
    });
    seed(test);
    storeJob(test.db, staleJob("blank", "Chatbot Developer", { locationRaw: "", isIndia: false }));

    const response = await put(test, testProfile, "?dryRun=true");

    // "dev", the blank-location job and the London one: the request is India-only, so all are India.
    expect((response.body as ProfileSaveResponse).after.high).toBe(3);
  });

  it("returns 400 with the reason for a profile that breaks the schema, and changes nothing", async () => {
    const test = createTestApp();
    seed(test);
    const broken = { ...testProfile, tiers: { high: 4, medium: 8, low: 16 } };

    const response = await put(test, broken);

    expect(response.status).toBe(400);
    expect((response.body as { message: string }).message).toContain("tiers");
    expect(test.savedProfiles).toEqual([]);
    expect(storedTier(test, "dev")).toBe("none");
  });

  it("rejects two concepts that share a phrase", async () => {
    const test = createTestApp();
    const duplicate: Profile = {
      ...testProfile,
      keywords: {
        ...testProfile.keywords,
        adjacent: [
          ...testProfile.keywords.adjacent,
          { term: "Chat Bot Pro", aliases: ["chatbot"] },
        ],
      },
    };

    const response = await put(test, duplicate, "?dryRun=true");

    expect(response.status).toBe(400);
    expect((response.body as { message: string }).message).toContain("already used");
  });

  it("returns 409 while a refresh is running", async () => {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Adapter = {
      ats: "greenhouse",
      async *fetchJobs() {
        await gate;
        yield makeJob("1");
        return { complete: true, stopReason: "end", pagesFetched: 1 };
      },
    };
    const test = createTestApp({ adapter: slow });
    await request(test.app).post("/api/refresh").send({});

    const response = await put(test, testProfile);
    release();

    expect(response.status).toBe(409);
    expect(test.savedProfiles).toEqual([]);
  });
});
