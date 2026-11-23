import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { googleCareersAdapter } from "../../src/adapters/google-careers";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, readFixture, recipeInput, textResponse } from "../helpers";

const pageHtml = readFixture("google-careers.html");

/** [[job, ...], null, total, pageSize] parsed from the saved page, to compare against the adapter. */
const resultsData = JSON.parse(/data:([\s\S]*), sideChannel/.exec(pageHtml)?.[1] ?? "null") as [
  [
    string,
    string,
    string,
    [null, string],
    [null, string],
    string,
    null,
    string,
    string,
    string[][],
    [null, string],
    number[],
    [number, number],
  ][],
  null,
  number,
  number,
];
const [savedJobs, , savedTotal] = resultsData;

const LIST_URL =
  "https://www.google.com/about/careers/applications/jobs/results?location=India&sort_by=date";

function googleRecipe(pagination: Record<string, unknown> = {}) {
  return CompanyRecipeSchema.parse(
    recipeInput("google", {
      ats: "google-careers",
      fetch: { url: LIST_URL, pagination: { maxPages: 5, sortedNewestFirst: true, ...pagination } },
      filters: { indiaFiltered: true },
    }),
  );
}

function pageWithData(data: unknown): string {
  return `<html><script>AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(data)}, sideChannel: {}});</script></html>`;
}

describe("google-careers adapter", () => {
  it("requests the newest-first India results page and maps the embedded jobs", async () => {
    const { client, requests } = fakeHttp(() => textResponse(pageHtml));

    const { jobs } = await drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(client));

    const url = new URL(requests[0]?.url ?? "");
    expect(url.origin + url.pathname).toBe(
      "https://www.google.com/about/careers/applications/jobs/results",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      location: "India",
      sort_by: "date",
      page: "1",
    });
    expect(requests[0]?.headers?.["accept"]).toContain("text/html");
    expect(jobs.map((job) => job.externalId)).toEqual(savedJobs.map((job) => String(job[0])));
    expect(jobs.map((job) => job.title)).toEqual(savedJobs.map((job) => job[1]));
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      savedJobs.map((job) => job[9].map((location) => location[0]).join(" | ")),
    );
  });

  it("builds public job URLs (not the sign-in link) and epoch-second posting times", async () => {
    const { client } = fakeHttp(() => textResponse(pageHtml));

    const { jobs } = await drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs[0]?.url).toBe(
      `https://www.google.com/about/careers/applications/jobs/results/${savedJobs[0]?.[0]}`,
    );
    expect(jobs.map((job) => job.postedRaw)).toEqual(savedJobs.map((job) => job[12][0]));
  });

  it("combines the about, responsibilities and qualifications HTML into the description", async () => {
    const { client } = fakeHttp(() => textResponse(pageHtml));

    const { jobs } = await drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(client));

    expect(jobs[0]?.description).toContain(savedJobs[0]?.[10][1]);
    expect(jobs[0]?.description).toContain(savedJobs[0]?.[3][1]);
    expect(jobs[0]?.description).toContain(savedJobs[0]?.[4][1]);
  });

  it("sends each keyword as q and pages with page=2, 3, ...", async () => {
    const { client, requests } = fakeHttp(() => textResponse(pageHtml));

    await drainAdapter(
      googleCareersAdapter,
      googleRecipe(),
      fetchContext(client, { keywords: ["conversational ai"], maxPages: 2 }),
    );

    expect(requests.map((req) => Object.fromEntries(new URL(req.url).searchParams))).toMatchObject([
      { q: "conversational ai", page: "1" },
      { q: "conversational ai", page: "2" },
    ]);
  });

  it("stops at the page cap while the total says there are more jobs", async () => {
    const { client } = fakeHttp(() => textResponse(pageHtml));

    const { outcome } = await drainAdapter(
      googleCareersAdapter,
      googleRecipe(),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(savedTotal).toBeGreaterThan(savedJobs.length);
    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("stops after a page of known jobs because results are newest first", async () => {
    const { client, requests } = fakeHttp(() => textResponse(pageHtml));
    const knownExternalIds = new Set(savedJobs.map((job) => String(job[0])));

    const { outcome } = await drainAdapter(
      googleCareersAdapter,
      googleRecipe(),
      fetchContext(client, { maxPages: 5, knownExternalIds }),
    );

    expect(requests).toHaveLength(1);
    expect(outcome).toEqual({ complete: false, stopReason: "known-ids", pagesFetched: 1 });
  });

  it("returns a complete empty fetch for a query without matches", async () => {
    const { client } = fakeHttp(() => textResponse(pageWithData([null, null, 0, 20])));

    const { jobs, outcome } = await drainAdapter(
      googleCareersAdapter,
      googleRecipe(),
      fetchContext(client),
    );

    expect(jobs).toEqual([]);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("is not confused by brackets and quotes inside the job text", async () => {
    const job = [
      "1",
      'Dialogflow ] "CX" [ Engineer',
      "",
      [null, "a ] b"],
      [null, ""],
      "",
      null,
      "Google",
      "en",
      [["Pune, India"]],
      [null, "[x]"],
      [],
      [1795171090, 0],
    ];
    const { client } = fakeHttp(() => textResponse(pageWithData([[job], null, 1, 20])));

    const { jobs } = await drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(client));

    expect(jobs.map((entry) => entry.title)).toEqual(['Dialogflow ] "CX" [ Engineer']);
  });

  it("throws a clear error when the data block or the job layout changes", async () => {
    const noData = fakeHttp(() => textResponse("<html>consent page</html>"));
    const badJob = fakeHttp(() => textResponse(pageWithData([[{ id: 1 }], null, 1, 20])));

    await expect(
      drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(noData.client)),
    ).rejects.toThrow(/layout/);
    await expect(
      drainAdapter(googleCareersAdapter, googleRecipe(), fetchContext(badJob.client)),
    ).rejects.toThrow(/layout/);
  });
});
