import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { smartRecruitersAdapter } from "../../src/adapters/smartrecruiters";
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

interface Posting {
  id: string;
  name: string;
  releasedDate: string;
  location: { fullLocation: string; remote: boolean };
}

const listing = readJsonFixture<{ totalFound: number; content: Posting[] }>("smartrecruiters.json");
const detail = readJsonFixture<{
  id: string;
  jobAd: { sections: Record<string, { text: string }> };
}>("smartrecruiters-job.json");

const LIST_URL = "https://api.smartrecruiters.com/v1/companies/ServiceNow/postings";

function smartRecruitersRecipe(pageSize?: number) {
  return CompanyRecipeSchema.parse(
    recipeInput("servicenow", {
      ats: "smartrecruiters",
      fetch: { url: LIST_URL, pagination: { maxPages: 5, pageSize, sortedNewestFirst: true } },
      filters: { location: "in", indiaFiltered: true },
    }),
  );
}

/** Serves slices of the saved real postings by offset/limit; totalFound as the API reports it. */
function pagedListing(totalFound = listing.content.length) {
  return fakeHttp((req) => {
    const url = new URL(req.url);
    const offset = Number(url.searchParams.get("offset"));
    const limit = Number(url.searchParams.get("limit"));
    return jsonResponse({
      offset,
      limit,
      totalFound,
      content: listing.content.slice(offset, offset + limit),
    });
  });
}

describe("smartrecruiters adapter", () => {
  it("adds the India country filter and paging to the recipe URL and maps the saved response", async () => {
    const { client, requests } = pagedListing();

    const { jobs, outcome } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(client),
    );

    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(LIST_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      country: "in",
      offset: "0",
      limit: "100",
    });
    expect(jobs.map((job) => job.externalId)).toEqual(listing.content.map((p) => p.id));
    expect(jobs.map((job) => job.title)).toEqual(listing.content.map((p) => p.name));
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("builds absolute public URLs and passes the release date through", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(client),
    );

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs.map((job) => job.url)).toEqual(
      listing.content.map((p) => `https://jobs.smartrecruiters.com/ServiceNow/${p.id}`),
    );
    expect(jobs.map((job) => job.postedRaw)).toEqual(listing.content.map((p) => p.releasedDate));
  });

  it("cleans the empty region out of fullLocation and appends Remote for remote postings", async () => {
    const remote = {
      ...listing.content[0],
      id: "remote-1",
      location: { fullLocation: "Pune, Maharashtra, India", remote: true },
    };
    const { client } = fakeHttp(() =>
      jsonResponse({ totalFound: 2, content: [listing.content[0], remote] }),
    );

    const { jobs } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(client),
    );

    expect(jobs.map((job) => job.locationRaw)).toEqual([
      "Hyderabad, India",
      "Pune, Maharashtra, India | Remote",
    ]);
  });

  it("leaves the description empty so the refresh service can request it for relevant jobs", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(client),
    );

    expect(jobs.every((job) => job.description === "" && job.detailRef === job.externalId)).toBe(
      true,
    );
  });

  it("sends each keyword as q", async () => {
    const { client, requests } = pagedListing();

    await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(client, { keywords: ["dialogflow", "conversational ai"] }),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("q"))).toEqual([
      "dialogflow",
      "conversational ai",
    ]);
  });

  it("pages with offset until totalFound, and caps the page size at the API maximum of 100", async () => {
    const { client, requests } = pagedListing(4);

    const { jobs, outcome } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(2),
      fetchContext(client, { maxPages: 5 }),
    );
    const oversized = pagedListing();
    await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(200),
      fetchContext(oversized.client),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("offset"))).toEqual(["0", "2"]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
    expect(new URL(oversized.requests[0]?.url ?? "").searchParams.get("limit")).toBe("100");
  });

  it("is incomplete at the page cap and stops early on a page of known IDs for newest-first recipes", async () => {
    const capped = pagedListing(80);
    const knownPage = pagedListing(80);

    const { outcome: cappedOutcome } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(2),
      fetchContext(capped.client, { maxPages: 1 }),
    );
    const { outcome: earlyOutcome } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(2),
      fetchContext(knownPage.client, {
        maxPages: 5,
        knownExternalIds: new Set(listing.content.map((p) => p.id)),
      }),
    );

    expect(cappedOutcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
    expect(earlyOutcome).toEqual({ complete: false, stopReason: "known-ids", pagesFetched: 1 });
  });

  it("fetches the description from the posting detail: job description and qualifications only", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(detail));

    const description = await smartRecruitersAdapter.fetchDescription?.(
      makeJob(detail.id, { detailRef: detail.id }),
      smartRecruitersRecipe(),
      fetchContext(client),
    );

    expect(requests[0]?.url).toBe(`${LIST_URL}/${detail.id}`);
    expect(description).toContain(detail.jobAd.sections.jobDescription?.text);
    expect(description).toContain(detail.jobAd.sections.qualifications?.text);
    expect(description).not.toContain(detail.jobAd.sections.companyDescription?.text);
  });

  it("yields postings it cannot read as empty jobs and fails clearly without a content array", async () => {
    const broken = fakeHttp(() =>
      jsonResponse({ totalFound: 2, content: [{ name: "No id" }, listing.content[0]] }),
    );
    const noContent = fakeHttp(() => jsonResponse({ message: "Not found" }));

    const { jobs } = await drainAdapter(
      smartRecruitersAdapter,
      smartRecruitersRecipe(),
      fetchContext(broken.client),
    );

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
    await expect(
      drainAdapter(smartRecruitersAdapter, smartRecruitersRecipe(), fetchContext(noContent.client)),
    ).rejects.toThrow(/no content array/);
  });
});
