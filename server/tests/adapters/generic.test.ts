import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { genericAdapter } from "../../src/adapters/generic";
import { parsePostedAt } from "../../src/lib/dates";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, jsonResponse, readJsonFixture, recipeInput } from "../helpers";

interface AmazonJob {
  id_icims: string;
  title: string;
  location: string;
  posted_date: string;
  job_path: string;
  description: string;
}

const fixture = readJsonFixture<{ hits: number; jobs: AmazonJob[] }>("generic.json");

const SEARCH_URL =
  "https://www.amazon.jobs/en/search.json?base_query={{keyword}}&country=IND&sort=recent";

const AMAZON_FIELD_MAP = {
  jobsPath: "jobs",
  externalId: "id_icims",
  title: "title",
  urlTemplate: "https://www.amazon.jobs{{job_path}}",
  location: "location",
  postedAt: "posted_date",
  description: "description",
  totalPath: "hits",
};

function genericRecipe(
  overrides: { fetch?: Record<string, unknown>; fieldMap?: Record<string, unknown> } = {},
) {
  return CompanyRecipeSchema.parse(
    recipeInput("amazon", {
      ats: "generic",
      fetch: {
        url: SEARCH_URL,
        pagination: {
          maxPages: 5,
          type: "offset",
          param: "offset",
          sizeParam: "result_limit",
          pageSize: 2,
        },
        ...overrides.fetch,
      },
      fieldMap: { ...AMAZON_FIELD_MAP, ...overrides.fieldMap },
      filters: { keywords: ["conversational"], indiaFiltered: true },
    }),
  );
}

/** Serves slices of the saved real jobs for the offset/result_limit in the request URL. */
function pagedListing(hits = fixture.jobs.length) {
  return fakeHttp((req) => {
    const params = new URL(req.url).searchParams;
    const offset = Number(params.get("offset"));
    const limit = Number(params.get("result_limit"));
    return jsonResponse({ hits, jobs: fixture.jobs.slice(offset, offset + limit) });
  });
}

describe("generic adapter", () => {
  it("maps the saved response through fieldMap dot paths and URL templates", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(jobs.map((job) => job.externalId)).toEqual(fixture.jobs.map((job) => job.id_icims));
    expect(jobs.map((job) => job.title)).toEqual(fixture.jobs.map((job) => job.title.trim()));
    expect(jobs.map((job) => job.locationRaw)).toEqual(fixture.jobs.map((job) => job.location));
    expect(jobs.map((job) => job.url)).toEqual(
      fixture.jobs.map((job) => `https://www.amazon.jobs${job.job_path}`),
    );
    expect(jobs.map((job) => job.description)).toEqual(
      fixture.jobs.map((job) => job.description.trim()),
    );
    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
  });

  it("passes the posted date text through so it parses to ISO", async () => {
    const { client } = pagedListing();

    const { jobs } = await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(jobs.map((job) => job.postedRaw)).toEqual(fixture.jobs.map((job) => job.posted_date));
    expect(parsePostedAt(jobs[0]?.postedRaw ?? null, new Date("2026-11-21T00:00:00Z"))).toMatch(
      /^2026-\d{2}-\d{2}T00:00:00\.000Z$/,
    );
  });

  it("substitutes each keyword for {{keyword}} in the URL, and an empty string without keywords", async () => {
    const { client, requests } = pagedListing(2);

    await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(client, { keywords: ["agent assist", "dialogflow"] }),
    );
    await drainAdapter(genericAdapter, genericRecipe(), fetchContext(client));

    expect(requests.map((req) => new URL(req.url).searchParams.get("base_query"))).toEqual([
      "agent assist",
      "dialogflow",
      "",
    ]);
    expect(new URL(requests[0]?.url ?? "").searchParams.get("country")).toBe("IND");
  });

  it("pages with the offset and size parameters until the total is reached", async () => {
    const { client, requests } = pagedListing(4);

    const { jobs, outcome } = await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(client, { maxPages: 5 }),
    );

    expect(
      requests.map((req) => {
        const params = new URL(req.url).searchParams;
        return [params.get("offset"), params.get("result_limit")];
      }),
    ).toEqual([
      ["0", "2"],
      ["2", "2"],
    ]);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops at the page cap while the total says there are more jobs", async () => {
    const { client } = pagedListing(30);

    const { outcome } = await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(client, { maxPages: 1 }),
    );

    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 1 });
  });

  it("without a total, keeps paging while pages are full and ends on a short page", async () => {
    const { client, requests } = pagedListing();
    const recipe = genericRecipe({
      fetch: {
        pagination: {
          maxPages: 5,
          type: "offset",
          param: "offset",
          sizeParam: "result_limit",
          pageSize: 3,
        },
      },
      fieldMap: { totalPath: undefined },
    });

    const { jobs, outcome } = await drainAdapter(
      genericAdapter,
      recipe,
      fetchContext(client, { maxPages: 5 }),
    );

    expect(requests).toHaveLength(2);
    expect(jobs).toHaveLength(4);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("makes a single request when the recipe has no pagination", async () => {
    const { client, requests } = pagedListing(500);
    const recipe = genericRecipe({ fetch: { pagination: { maxPages: 5, type: "none" } } });

    const { outcome } = await drainAdapter(
      genericAdapter,
      recipe,
      fetchContext(client, { maxPages: 5 }),
    );

    expect(requests).toHaveLength(1);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("stops after a page of known jobs only for recipes sorted newest first", async () => {
    const knownExternalIds = new Set(fixture.jobs.slice(0, 2).map((job) => job.id_icims));
    const sorted = pagedListing(30);
    const unsorted = pagedListing(30);

    const sortedRun = await drainAdapter(
      genericAdapter,
      genericRecipe({
        fetch: {
          pagination: {
            maxPages: 5,
            type: "offset",
            param: "offset",
            sizeParam: "result_limit",
            pageSize: 2,
            sortedNewestFirst: true,
          },
        },
      }),
      fetchContext(sorted.client, { maxPages: 5, knownExternalIds }),
    );
    const unsortedRun = await drainAdapter(
      genericAdapter,
      genericRecipe(),
      fetchContext(unsorted.client, { maxPages: 2, knownExternalIds }),
    );

    expect(sortedRun.outcome).toEqual({
      complete: false,
      stopReason: "known-ids",
      pagesFetched: 1,
    });
    expect(unsortedRun.outcome.stopReason).toBe("page-cap");
  });

  it("builds POST bodies: keyword placeholder in strings, page and size at dot paths", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse({ data: { items: fixture.jobs } }));
    const recipe = genericRecipe({
      fetch: {
        url: "https://api.example.com/search",
        method: "POST",
        body: { query: { text: "{{keyword}}" }, country: "IND" },
        pagination: {
          maxPages: 5,
          type: "page",
          param: "paging.page",
          sizeParam: "paging.size",
          pageSize: 4,
        },
      },
      fieldMap: {
        jobsPath: "data.items",
        url: "job_path",
        urlTemplate: undefined,
        totalPath: undefined,
      },
    });

    const { jobs } = await drainAdapter(
      genericAdapter,
      recipe,
      fetchContext(client, { keywords: ["dialogflow"], maxPages: 2 }),
    );

    expect(requests.map((req) => [req.method, req.body])).toEqual([
      ["POST", { query: { text: "dialogflow" }, country: "IND", paging: { page: 1, size: 4 } }],
      ["POST", { query: { text: "dialogflow" }, country: "IND", paging: { page: 2, size: 4 } }],
    ]);
    expect(jobs[0]?.url).toBe(`https://api.example.com${fixture.jobs[0]?.job_path}`);
  });

  it("yields entries without an id or a usable URL as invalid jobs", async () => {
    const { client } = fakeHttp(() =>
      jsonResponse({
        hits: 2,
        jobs: [{ title: "No id", job_path: "/en/jobs/1" }, fixture.jobs[0]],
      }),
    );

    const { jobs } = await drainAdapter(genericAdapter, genericRecipe(), fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
  });

  it("treats a missing jobs array as empty when the reported total is 0", async () => {
    const { client } = fakeHttp(() => jsonResponse({ hits: 0 }));
    const recipe = genericRecipe();

    const { jobs } = await drainAdapter(genericAdapter, recipe, fetchContext(client));

    expect(jobs).toEqual([]);
  });

  it("joins array locations and fails clearly when the jobs array is missing", async () => {
    const { client } = fakeHttp(() =>
      jsonResponse({ hits: 1, jobs: [{ ...fixture.jobs[0], location: ["Pune", "Mumbai"] }] }),
    );
    const missing = fakeHttp(() => jsonResponse({ error: "bad request" }));

    const { jobs } = await drainAdapter(genericAdapter, genericRecipe(), fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Pune | Mumbai");
    await expect(
      drainAdapter(genericAdapter, genericRecipe(), fetchContext(missing.client)),
    ).rejects.toThrow('no jobs array at "jobs"');
  });
});
