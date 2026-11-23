import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { workdayAdapter } from "../../src/adapters/workday";
import { parsePostedAt } from "../../src/lib/dates";
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

interface WorkdayFixture {
  total: number;
  jobPostings: {
    title: string;
    externalPath: string;
    locationsText?: string;
    postedOn: string;
    bulletFields: string[];
  }[];
}

const listing = readJsonFixture<WorkdayFixture>("workday.json");
const accenture = readJsonFixture<WorkdayFixture>("workday-accenture.json");
const zendesk = readJsonFixture<WorkdayFixture>("workday-zendesk.json");
const detail = readJsonFixture<{ jobPostingInfo: { jobDescription: string } }>("workday-job.json");

const LIST_URL =
  "https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs";
const INDIA_FACETS = { locationHierarchy1: ["2fcb99c455831013ea52b82135ba3266"] };

function workdayRecipe(pagination: Record<string, unknown> = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("nvidia", {
      ats: "workday",
      fetch: {
        url: LIST_URL,
        method: "POST",
        headers: {},
        body: { appliedFacets: INDIA_FACETS, limit: 20, offset: 0, searchText: "" },
        pagination: { maxPages: 5, ...pagination },
      },
      filters: { indiaFiltered: true },
    }),
  );
}

/** Serves the saved real postings as pages, the way Workday does (total only on offset 0). */
function pagedListing(total = listing.total) {
  return fakeHttp((req) => {
    const { offset, limit } = req.body as { offset: number; limit: number };
    return jsonResponse({
      total: offset === 0 ? total : 0,
      jobPostings: listing.jobPostings.slice(offset, offset + limit),
    });
  });
}

describe("workday adapter", () => {
  it("posts the recipe body with its India facet and maps every job in the saved response", async () => {
    const { client, requests } = pagedListing();

    const { jobs, outcome } = await drainAdapter(
      workdayAdapter,
      workdayRecipe(),
      fetchContext(client),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: LIST_URL,
      method: "POST",
      body: { appliedFacets: INDIA_FACETS, limit: 20, offset: 0, searchText: "" },
    });
    expect(jobs.map((job) => job.title)).toEqual(listing.jobPostings.map((job) => job.title));
    expect(jobs.map((job) => job.externalId)).toEqual(
      listing.jobPostings.map((job) => job.bulletFields[0]),
    );
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      listing.jobPostings.map((job) => job.locationsText),
    );
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("reads the city from the second bullet field when the tenant sends no locationsText (Accenture)", async () => {
    const { client } = fakeHttp(() => jsonResponse(accenture));

    const { jobs } = await drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client));

    expect(accenture.jobPostings.every((job) => job.locationsText === undefined)).toBe(true);
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      accenture.jobPostings.map((job) => job.bulletFields[1]),
    );
    expect(jobs[0]?.locationRaw).toBe("Pune");
    expect(jobs[0]?.externalId).toBe(accenture.jobPostings[0]?.bulletFields[0]);
  });

  it("treats the '2 Locations' placeholder as an unknown location and keeps real ones", async () => {
    const { client } = fakeHttp(() => jsonResponse(zendesk));

    const { jobs } = await drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client));

    expect(zendesk.jobPostings.map((job) => job.locationsText)).toContain("2 Locations");
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      zendesk.jobPostings.map((job) =>
        /^\d+ Locations$/.test(job.locationsText ?? "") ? "" : job.locationsText,
      ),
    );
  });

  it("builds absolute public job URLs from the site name and externalPath", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client));

    expect(jobs[0]?.url).toBe(
      `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite${listing.jobPostings[0]?.externalPath}`,
    );
    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
  });

  it("keeps the relative 'Posted ...' text so it can be parsed against the fetch time", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client));

    expect(jobs[0]?.postedRaw).toBe(listing.jobPostings[0]?.postedOn);
    expect(parsePostedAt(jobs[0]?.postedRaw ?? null, new Date("2026-11-21T10:00:00Z"))).toBe(
      "2026-11-21T10:00:00.000Z",
    );
  });

  it("sends each keyword as searchText, one query per keyword", async () => {
    const { client, requests } = pagedListing(2);

    await drainAdapter(
      workdayAdapter,
      workdayRecipe(),
      fetchContext(client, { keywords: ["Dialogflow", "Agent Assist"] }),
    );

    expect(requests.map((req) => (req.body as { searchText: string }).searchText)).toEqual([
      "Dialogflow",
      "Agent Assist",
    ]);
  });

  it("pages with offset and limit, using the total from the first page only", async () => {
    const { client, requests } = pagedListing(4);

    const { jobs, outcome } = await drainAdapter(
      workdayAdapter,
      workdayRecipe({ pageSize: 2 }),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(requests.map((req) => req.body)).toMatchObject([
      { offset: 0, limit: 2 },
      { offset: 2, limit: 2 },
    ]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops at the page cap while the total says there are more jobs", async () => {
    const { client, requests } = pagedListing(237);

    const { outcome } = await drainAdapter(
      workdayAdapter,
      workdayRecipe({ pageSize: 2 }),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(requests).toHaveLength(1);
    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("stops early on a page of known jobs only for recipes sorted newest first", async () => {
    const knownExternalIds = new Set(
      listing.jobPostings.slice(0, 2).map((job) => job.bulletFields[0] ?? ""),
    );

    const sorted = pagedListing(237);
    const sortedOutcome = await drainAdapter(
      workdayAdapter,
      workdayRecipe({ pageSize: 2, sortedNewestFirst: true }),
      fetchContext(sorted.client, { maxPages: 5, knownExternalIds }),
    );
    const unsorted = pagedListing(237);
    const unsortedOutcome = await drainAdapter(
      workdayAdapter,
      workdayRecipe({ pageSize: 2 }),
      fetchContext(unsorted.client, { maxPages: 2, knownExternalIds }),
    );

    expect(sortedOutcome.outcome).toEqual({
      complete: false,
      stopReason: "known-ids",
      pagesFetched: 1,
    });
    expect(unsortedOutcome.outcome).toMatchObject({ stopReason: "page-cap", pagesFetched: 2 });
  });

  it("fetches the job description from the cxs job endpoint using the detailRef", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(detail));
    const job = makeJob("JR2030308", { detailRef: listing.jobPostings[0]?.externalPath });

    const description = await workdayAdapter.fetchDescription?.(
      job,
      workdayRecipe(),
      fetchContext(client),
    );

    expect(requests[0]?.url).toBe(
      `https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite${listing.jobPostings[0]?.externalPath}`,
    );
    expect(description).toBe(detail.jobPostingInfo.jobDescription);
  });

  it("yields entries it cannot read as empty jobs so the refresh service counts them invalid", async () => {
    const { client } = fakeHttp(() =>
      jsonResponse({ total: 2, jobPostings: [{ title: "No path" }, listing.jobPostings[0]] }),
    );

    const { jobs } = await drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
  });

  it("fails clearly on a non-Workday URL or a response without jobPostings", async () => {
    const { client } = fakeHttp(() => jsonResponse({ errorCode: "HTTP_400" }));
    const wrongUrl = CompanyRecipeSchema.parse(
      recipeInput("nvidia", {
        ats: "workday",
        fetch: { url: "https://nvidia.wd5.myworkdayjobs.com/jobs", method: "POST", body: {} },
      }),
    );

    await expect(drainAdapter(workdayAdapter, wrongUrl, fetchContext(client))).rejects.toThrow(
      /Not a Workday listing URL/,
    );
    await expect(
      drainAdapter(workdayAdapter, workdayRecipe(), fetchContext(client)),
    ).rejects.toThrow(/no jobPostings/);
  });
});
