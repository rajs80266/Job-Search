import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { oracleHcmAdapter } from "../../src/adapters/oracle-hcm";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, jsonResponse, readJsonFixture, recipeInput } from "../helpers";

interface Requisition {
  Id: string;
  Title: string;
  PostedDate: string;
  PrimaryLocation: string;
  ShortDescriptionStr: string;
  secondaryLocations: { Name: string }[];
}

interface OracleFixture {
  items: { TotalJobsCount: number; requisitionList: Requisition[] }[];
  hasMore: boolean;
}

const fixture = readJsonFixture<OracleFixture>("oracle-hcm.json");
const requisitions = fixture.items[0]?.requisitionList ?? [];

const INDIA_LOCATION_ID = "300000000289360";
const BASE =
  "https://jpmc.fa.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions";
const LIST_URL = `${BASE}?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;siteNumber=CX_1001,facetsList=LOCATIONS%3BTITLES,sortBy=POSTING_DATES_DESC,limit=14,offset=0`;

function oracleRecipe(url = LIST_URL, pagination: Record<string, unknown> = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("jpmorgan", {
      ats: "oracle-hcm",
      fetch: { url, pagination: { maxPages: 5, ...pagination } },
      filters: { location: INDIA_LOCATION_ID, indiaFiltered: true },
    }),
  );
}

/** The raw `key=value` pairs inside the finder, e.g. { limit: "25", offset: "0" }. */
function finderParams(rawUrl: string): Record<string, string> {
  const finder = /[?&]finder=([^&]*)/.exec(rawUrl)?.[1] ?? "";
  const params = finder.slice(finder.indexOf(";") + 1).split(",");
  return Object.fromEntries(params.map((param) => param.split("=") as [string, string]));
}

/** Serves the saved real requisitions by offset/limit; TotalJobsCount is configurable. */
function pagedListing(total = fixture.items[0]?.TotalJobsCount ?? 0) {
  return fakeHttp((req) => {
    const { offset, limit } = finderParams(req.url);
    const start = Number(offset);
    return jsonResponse({
      ...fixture,
      items: [
        {
          ...fixture.items[0],
          TotalJobsCount: total,
          requisitionList: requisitions.slice(start, start + Number(limit)),
        },
      ],
    });
  });
}

describe("oracle-hcm adapter", () => {
  it("edits only limit, offset and locationId in the finder and maps the saved response", async () => {
    const { client, requests } = pagedListing();

    const { jobs } = await drainAdapter(oracleHcmAdapter, oracleRecipe(), fetchContext(client));

    const rawUrl = requests[0]?.url ?? "";
    expect(
      rawUrl.startsWith(
        `${BASE}?onlyData=true&expand=requisitionList.secondaryLocations&finder=findReqs;`,
      ),
    ).toBe(true);
    expect(finderParams(rawUrl)).toEqual({
      siteNumber: "CX_1001",
      facetsList: "LOCATIONS%3BTITLES",
      sortBy: "POSTING_DATES_DESC",
      limit: "25",
      offset: "0",
      locationId: INDIA_LOCATION_ID,
    });
    expect(jobs.map((job) => job.externalId)).toEqual(requisitions.map((r) => r.Id));
    expect(jobs.map((job) => job.title)).toEqual(requisitions.map((r) => r.Title));
    expect(jobs.map((job) => job.postedRaw)).toEqual(requisitions.map((r) => r.PostedDate));
    expect(jobs.map((job) => job.description)).toEqual(
      requisitions.map((r) => r.ShortDescriptionStr),
    );
  });

  it("joins the primary and secondary locations and builds absolute candidate-site URLs", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(oracleHcmAdapter, oracleRecipe(), fetchContext(client));

    const withSecondary = requisitions.findIndex((r) => r.secondaryLocations.length > 0);
    expect(withSecondary).toBeGreaterThanOrEqual(0);
    expect(jobs[withSecondary]?.locationRaw).toBe(
      [
        requisitions[withSecondary]?.PrimaryLocation,
        requisitions[withSecondary]?.secondaryLocations[0]?.Name,
      ].join(" | "),
    );
    expect(jobs[0]?.url).toBe(
      `https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/${requisitions[0]?.Id}`,
    );
    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
  });

  it("sends each keyword inside the finder, URL-encoded", async () => {
    const { client, requests } = pagedListing(4);

    await drainAdapter(
      oracleHcmAdapter,
      oracleRecipe(),
      fetchContext(client, { keywords: ["agent assist", "dialogflow"] }),
    );

    expect(requests.map((req) => finderParams(req.url)["keyword"])).toEqual([
      "agent%20assist",
      "dialogflow",
    ]);
  });

  it("pages by offset using TotalJobsCount, not the response's own hasMore flag", async () => {
    const { client, requests } = pagedListing(4);

    const { jobs, outcome } = await drainAdapter(
      oracleHcmAdapter,
      oracleRecipe(LIST_URL, { pageSize: 2 }),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(fixture.hasMore).toBe(false);
    expect(requests.map((req) => finderParams(req.url)["offset"])).toEqual(["0", "2"]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops at the page cap while TotalJobsCount says there are more jobs", async () => {
    const { client } = pagedListing();

    const { outcome } = await drainAdapter(
      oracleHcmAdapter,
      oracleRecipe(),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("adds the requisitionList expansion when the recipe URL lacks it", async () => {
    const { client, requests } = pagedListing();
    const withoutExpand = `${BASE}?onlyData=true&finder=findReqs;siteNumber=CX_1001,limit=14,offset=0`;

    await drainAdapter(oracleHcmAdapter, oracleRecipe(withoutExpand), fetchContext(client));

    expect(requests[0]?.url).toContain("&expand=requisitionList.secondaryLocations");
  });

  it("fails clearly on a URL without a finder, or a response without requisitionList", async () => {
    const { client } = fakeHttp(() => jsonResponse({ items: [{ TotalJobsCount: 0 }] }));
    const noFinder = oracleRecipe(`${BASE}?onlyData=true`);

    await expect(drainAdapter(oracleHcmAdapter, noFinder, fetchContext(client))).rejects.toThrow(
      /no finder/,
    );
    await expect(
      drainAdapter(oracleHcmAdapter, oracleRecipe(), fetchContext(client)),
    ).rejects.toThrow(/no requisitionList/);
  });
});
