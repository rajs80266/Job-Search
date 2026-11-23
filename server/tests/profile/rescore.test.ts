import { describe, expect, it } from "vitest";
import { recordCompanySuccess, upsertCompany } from "../../src/db/companies";
import { openDatabase } from "../../src/db/connection";
import { rescoreStoredJobs } from "../../src/profile/rescore";
import type { NormalizedJob } from "../../src/types";
import { storeJob, testProfile } from "../helpers";

const AT = "2026-11-01T00:00:00.000Z";

function job(id: string, overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    id,
    companySlug: "acme",
    externalId: id,
    title: "Software Engineer",
    url: `https://jobs.example/${id}`,
    locationRaw: "Pune, India",
    cities: ["Pune"],
    isIndia: true,
    isRemote: false,
    postedAt: null,
    firstSeenAt: AT,
    lastSeenAt: AT,
    closedAt: null,
    descriptionSnippet: "",
    relevanceScore: 12,
    relevanceTier: "medium",
    matchedKeywords: ["contact center"],
    ...overrides,
  };
}

function database() {
  const db = openDatabase(":memory:");
  upsertCompany(db, {
    slug: "acme",
    name: "Acme",
    category: "cx-vendor",
    ats: "greenhouse",
    status: "verified",
  });
  recordCompanySuccess(db, "acme", AT);
  return db;
}

const tierOf = (db: ReturnType<typeof database>, id: string): string =>
  (db.prepare("SELECT relevance_tier AS tier FROM jobs WHERE id = ?").get(id) as { tier: string })
    .tier;

describe("rescoreStoredJobs", () => {
  it("applies the company boilerplate rule, like a refresh does", () => {
    const db = database();
    const aboutUs = "Our contact center platform with Genesys, IVR and NLU serves everyone.";
    for (let index = 0; index < 10; index++) {
      storeJob(db, job(`j${index}`, { descriptionSnippet: `${aboutUs} Role ${index}.` }));
    }

    const result = rescoreStoredJobs(db, testProfile, new Map(), { write: true });

    expect(result.before.medium).toBe(10);
    expect(result.after).toEqual({ high: 0, medium: 0, low: 0, none: 10 });
    expect(tierOf(db, "j0")).toBe("none");
  });

  it("does not apply it to a small board", () => {
    const db = database();
    const aboutUs = "Our contact center platform with Genesys, IVR and NLU serves everyone.";
    for (let index = 0; index < 3; index++) {
      storeJob(db, job(`j${index}`, { descriptionSnippet: aboutUs }));
    }

    const result = rescoreStoredJobs(db, testProfile, new Map(), { write: false });

    expect(result.after.none).toBe(0);
    expect(result.after.high + result.after.medium + result.after.low).toBe(3);
  });

  it("counts only open India jobs, but re-scores closed ones too", () => {
    const db = database();
    storeJob(db, job("open", { title: "Dialogflow CX Developer" }));
    storeJob(db, job("closed", { title: "Dialogflow CX Developer", closedAt: AT }));

    const result = rescoreStoredJobs(db, testProfile, new Map(), { write: true });

    expect(result.rescored).toBe(2);
    expect(result.after.high).toBe(1);
    expect(tierOf(db, "closed")).toBe("high");
  });

  it("writes nothing on a dry run", () => {
    const db = database();
    storeJob(db, job("a", { title: "Dialogflow CX Developer" }));

    rescoreStoredJobs(db, testProfile, new Map(), { write: false });

    expect(tierOf(db, "a")).toBe("medium");
  });
});
