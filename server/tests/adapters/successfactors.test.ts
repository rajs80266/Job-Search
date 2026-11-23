import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { successFactorsAdapter } from "../../src/adapters/successfactors";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import {
  fakeHttp,
  fetchContext,
  makeJob,
  readFixture,
  recipeInput,
  textResponse,
} from "../helpers";

const listingHtml = readFixture("successfactors.html");
const jobPageHtml = readFixture("successfactors-job.html");

const SEARCH_URL = "https://careers.ey.com/search/?q=&locationsearch=";

function successFactorsRecipe(pagination: Record<string, unknown> = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("ey", {
      ats: "successfactors",
      fetch: { url: SEARCH_URL, pagination: { maxPages: 5, ...pagination } },
      filters: { location: "India", indiaFiltered: true },
    }),
  );
}

/** The saved page says "Results 1 – 25 of 3137" but holds 4 rows; this rewrites that total. */
function listingWithTotal(total: number): string {
  return listingHtml.replace("<b>3137</b>", `<b>${total}</b>`);
}

describe("successfactors adapter", () => {
  it("sends the recipe URL with the India location and startrow, and maps the saved rows", async () => {
    const { client, requests } = fakeHttp(() => textResponse(listingHtml));

    const { jobs } = await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client),
    );

    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe("https://careers.ey.com/search/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "",
      locationsearch: "India",
      startrow: "0",
    });
    expect(requests[0]?.headers?.["accept"]).toContain("text/html");
    expect(jobs.map((job) => job.externalId)).toEqual([
      "1445476333",
      "1448451533",
      "1459218433",
      "1458124833",
    ]);
    expect(jobs.map((job) => job.title)).toEqual([
      "BCM -Fraud and Financial Crime-Senior-GDSF02",
      "Guidewire Digital-Senior",
      "SAP Spartacus-Senior",
      "SAP SAC Planning-Manager",
    ]);
  });

  it("resolves relative job links to absolute URLs and drops the '+N more' marker from locations", async () => {
    const { client } = fakeHttp(() => textResponse(listingHtml));

    const { jobs } = await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client),
    );

    expect(jobs[0]?.url).toBe(
      "https://careers.ey.com/ey/job/Bengaluru-BCM-Fraud-and-Financial-Crime-Senior-GDSF02-KA-560016/1445476333/",
    );
    expect(jobs[0]?.locationRaw).toBe("Bengaluru, KA, IN, 560016");
    expect(jobs[0]?.postedRaw).toBeNull();
    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
  });

  it("sends each keyword as q", async () => {
    const { client, requests } = fakeHttp(() => textResponse(listingWithTotal(4)));

    await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client, { keywords: ["conversational ai", "dialogflow"] }),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("q"))).toEqual([
      "conversational ai",
      "dialogflow",
    ]);
  });

  it("pages with startrow by the number of rows already received, until the total", async () => {
    const { client, requests } = fakeHttp(() => textResponse(listingWithTotal(8)));

    const { jobs, outcome } = await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(requests.map((req) => new URL(req.url).searchParams.get("startrow"))).toEqual([
      "0",
      "4",
    ]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops at the page cap when the total says there are more rows", async () => {
    const { client } = fakeHttp(() => textResponse(listingHtml));

    const { outcome } = await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("returns no jobs and a complete fetch for a page without result rows", async () => {
    const { client } = fakeHttp(() => textResponse("<html><body><p>No results</p></body></html>"));

    const { jobs, outcome } = await drainAdapter(
      successFactorsAdapter,
      successFactorsRecipe(),
      fetchContext(client),
    );

    expect(jobs).toEqual([]);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("reads the description HTML from the job page", async () => {
    const { client, requests } = fakeHttp(() => textResponse(jobPageHtml));
    const job = makeJob("1448451533", { url: "https://careers.ey.com/ey/job/x/1448451533/" });

    const description = await successFactorsAdapter.fetchDescription?.(
      job,
      successFactorsRecipe(),
      fetchContext(client),
    );

    expect(requests[0]?.url).toBe(job.url);
    expect(description).toContain("At EY, we’re all in to shape your future");
    expect(description).toContain("<p>");
  });

  it("fails clearly when the job page has no description", async () => {
    const { client } = fakeHttp(() => textResponse("<html><body>Sign in</body></html>"));

    await expect(
      successFactorsAdapter.fetchDescription?.(
        makeJob("1"),
        successFactorsRecipe(),
        fetchContext(client),
      ),
    ).rejects.toThrow(/no description/);
  });
});
