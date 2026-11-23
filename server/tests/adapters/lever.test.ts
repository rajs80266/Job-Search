import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { leverAdapter } from "../../src/adapters/lever";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, jsonResponse, readJsonFixture, recipeInput } from "../helpers";

interface Posting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt: number;
  categories: { location: string; allLocations: string[] };
  descriptionPlain: string;
}

const postings = readJsonFixture<Posting[]>("lever.json");

const LIST_URL = "https://api.lever.co/v0/postings/meesho?mode=json";

function leverRecipe(overrides: { pageSize?: number; location?: string } = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("meesho", {
      ats: "lever",
      fetch: { url: LIST_URL, pagination: { maxPages: 5, pageSize: overrides.pageSize } },
      filters: overrides.location ? { location: overrides.location } : {},
    }),
  );
}

/** Serves slices of the saved real postings by skip/limit, as the API does. */
function pagedPostings(all: unknown[] = postings) {
  return fakeHttp((req) => {
    const url = new URL(req.url);
    const skip = Number(url.searchParams.get("skip"));
    const limit = Number(url.searchParams.get("limit"));
    return jsonResponse(all.slice(skip, skip + limit));
  });
}

describe("lever adapter", () => {
  it("keeps the recipe URL, adds skip/limit paging, and maps the saved response", async () => {
    const { client, requests } = pagedPostings();

    const { jobs, outcome } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://api.lever.co/v0/postings/meesho");
    expect(Object.fromEntries(url.searchParams)).toEqual({ mode: "json", skip: "0", limit: "100" });
    expect(jobs.map((job) => job.externalId)).toEqual(postings.map((p) => p.id));
    expect(jobs.map((job) => job.title)).toEqual(postings.map((p) => p.text));
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("returns absolute URLs and ISO-convertible posting times", async () => {
    const { client } = pagedPostings();

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs.map((job) => job.url)).toEqual(postings.map((p) => p.hostedUrl));
    expect(jobs.map((job) => job.postedRaw)).toEqual(postings.map((p) => p.createdAt));
  });

  it("adds India to locations that only give a city and region, using the posting's country code", async () => {
    const { client } = pagedPostings();

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Bangalore, Karnataka, India");
  });

  it("marks remote postings so the location parser sees them", async () => {
    const remote = { ...postings[0], workplaceType: "remote" };
    const { client } = pagedPostings([remote]);

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Bangalore, Karnataka, India | Remote");
  });

  it("joins every location of a posting", async () => {
    const multi = {
      ...postings[0],
      country: undefined,
      categories: { allLocations: ["Pune", "Mumbai"] },
    };
    const { client } = pagedPostings([multi]);

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Pune | Mumbai");
  });

  it("includes the description and the requirement lists as HTML", async () => {
    const { client } = pagedPostings();

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(client));

    expect(jobs[0]?.description).toContain("About the Team");
    expect(jobs[0]?.description).toContain("<h3>What you will do</h3>");
  });

  it("sends filters.location as the location parameter", async () => {
    const { client, requests } = pagedPostings();

    await drainAdapter(
      leverAdapter,
      leverRecipe({ location: "Bangalore, Karnataka" }),
      fetchContext(client),
    );

    expect(new URL(requests[0]?.url ?? "").searchParams.get("location")).toBe(
      "Bangalore, Karnataka",
    );
  });

  it("ignores keywords: Lever has no search, so it does not repeat the same query", async () => {
    const { client, requests } = pagedPostings();

    await drainAdapter(
      leverAdapter,
      leverRecipe(),
      fetchContext(client, { keywords: ["dialogflow", "chatbot"] }),
    );

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]?.url ?? "").searchParams.has("q")).toBe(false);
  });

  it("pages with skip until a short page, and reports the page cap as incomplete", async () => {
    const full = pagedPostings();
    const capped = pagedPostings();

    const { jobs, outcome } = await drainAdapter(
      leverAdapter,
      leverRecipe({ pageSize: 2 }),
      fetchContext(full.client, { maxPages: 5 }),
    );
    const { outcome: cappedOutcome } = await drainAdapter(
      leverAdapter,
      leverRecipe({ pageSize: 2 }),
      fetchContext(capped.client, { maxPages: 1 }),
    );

    expect(full.requests.map((req) => new URL(req.url).searchParams.get("skip"))).toEqual([
      "0",
      "2",
      "4",
    ]);
    expect(jobs).toHaveLength(postings.length);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 3 });
    expect(cappedOutcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("does not stop early on known IDs because Lever does not sort by date", async () => {
    const { client } = pagedPostings();
    const known = new Set(postings.map((p) => p.id));

    const { outcome } = await drainAdapter(
      leverAdapter,
      leverRecipe({ pageSize: 2 }),
      fetchContext(client, { maxPages: 5, knownExternalIds: known }),
    );

    expect(outcome.stopReason).toBe("end");
  });

  it("yields postings it cannot read as empty jobs and fails clearly on a non-array response", async () => {
    const broken = fakeHttp(() => jsonResponse([{ text: "No id" }, postings[0]]));
    const notAnArray = fakeHttp(() => jsonResponse({ ok: false, error: "Document not found" }));

    const { jobs } = await drainAdapter(leverAdapter, leverRecipe(), fetchContext(broken.client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
    await expect(
      drainAdapter(leverAdapter, leverRecipe(), fetchContext(notAnArray.client)),
    ).rejects.toThrow(/not a postings array/);
  });
});
