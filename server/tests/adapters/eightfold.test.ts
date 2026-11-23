import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { eightfoldAdapter } from "../../src/adapters/eightfold";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import {
  fakeHttp,
  fetchContext,
  jsonResponse,
  makeJob,
  readJsonFixture,
  recipeInput,
} from "../helpers";

interface Position {
  id: number;
  name: string;
  location: string;
  locations: string[];
  t_create: number;
  canonicalPositionUrl: string;
}

const listing = readJsonFixture<{ count: number; positions: Position[] }>("eightfold.json");
const detail = readJsonFixture<{ id: number; job_description: string }>("eightfold-job.json");

const LIST_URL = "https://explore.jobs.netflix.net/api/apply/v2/jobs?domain=netflix.com";

function eightfoldRecipe(pagination: Record<string, unknown> = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("netflix", {
      ats: "eightfold",
      fetch: { url: LIST_URL, pagination: { maxPages: 5, ...pagination } },
      filters: { location: "India", indiaFiltered: true },
    }),
  );
}

/** Serves slices of the saved real positions by start/num, as the API does. */
function pagedListing(count = listing.positions.length) {
  return fakeHttp((req) => {
    const url = new URL(req.url);
    const start = Number(url.searchParams.get("start"));
    const num = Number(url.searchParams.get("num"));
    return jsonResponse({ count, positions: listing.positions.slice(start, start + num) });
  });
}

describe("eightfold adapter", () => {
  it("keeps the recipe domain, adds the India location and paging, and maps the saved response", async () => {
    const { client, requests } = pagedListing();

    const { jobs, outcome } = await drainAdapter(
      eightfoldAdapter,
      eightfoldRecipe(),
      fetchContext(client),
    );

    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://explore.jobs.netflix.net/api/apply/v2/jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      domain: "netflix.com",
      location: "India",
      start: "0",
      num: "10",
    });
    expect(jobs.map((job) => job.externalId)).toEqual(listing.positions.map((p) => String(p.id)));
    expect(jobs.map((job) => job.title)).toEqual(listing.positions.map((p) => p.name));
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      listing.positions.map((p) => p.locations.join(" | ")),
    );
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("returns absolute URLs and epoch-second posting times", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(eightfoldAdapter, eightfoldRecipe(), fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs.map((job) => job.url)).toEqual(
      listing.positions.map((p) => p.canonicalPositionUrl),
    );
    expect(jobs.map((job) => job.postedRaw)).toEqual(listing.positions.map((p) => p.t_create));
  });

  it("sends each keyword as the query parameter", async () => {
    const { client, requests } = pagedListing();

    await drainAdapter(
      eightfoldAdapter,
      eightfoldRecipe(),
      fetchContext(client, { keywords: ["conversational ai", "dialogflow"] }),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("query"))).toEqual([
      "conversational ai",
      "dialogflow",
    ]);
  });

  it("pages with start and num until the count is reached", async () => {
    const { client, requests } = pagedListing(4);

    const { jobs, outcome } = await drainAdapter(
      eightfoldAdapter,
      eightfoldRecipe({ pageSize: 2 }),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("start"))).toEqual(["0", "2"]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("never asks for more than the 10 jobs per page the API allows", async () => {
    const { client, requests } = pagedListing();

    await drainAdapter(eightfoldAdapter, eightfoldRecipe({ pageSize: 50 }), fetchContext(client));

    expect(new URL(requests[0]?.url ?? "").searchParams.get("num")).toBe("10");
  });

  it("reports an incomplete fetch when the count says more jobs exist than the page cap allows", async () => {
    const { client } = pagedListing(9);

    const { outcome } = await drainAdapter(
      eightfoldAdapter,
      eightfoldRecipe(),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("fetches the description from the per-job endpoint, keeping only the domain", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(detail));

    const description = await eightfoldAdapter.fetchDescription?.(
      makeJob(String(detail.id), { detailRef: String(detail.id) }),
      eightfoldRecipe(),
      fetchContext(client),
    );

    expect(requests[0]?.url).toBe(
      `https://explore.jobs.netflix.net/api/apply/v2/jobs/${detail.id}?domain=netflix.com`,
    );
    expect(description).toBe(detail.job_description);
  });

  it("yields positions it cannot read as empty jobs and fails clearly without a positions array", async () => {
    const broken = fakeHttp(() =>
      jsonResponse({ count: 2, positions: [{ name: "No id" }, listing.positions[0]] }),
    );
    const noPositions = fakeHttp(() => jsonResponse({ message: "Not authorized for PCSX" }));

    const { jobs } = await drainAdapter(
      eightfoldAdapter,
      eightfoldRecipe(),
      fetchContext(broken.client),
    );

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
    await expect(
      drainAdapter(eightfoldAdapter, eightfoldRecipe(), fetchContext(noPositions.client)),
    ).rejects.toThrow(/no positions array/);
  });
});
