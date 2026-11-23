import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { greenhouseAdapter } from "../../src/adapters/greenhouse";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema, type FetchContext } from "../../src/types";
import { fakeHttp, jsonResponse, recipeInput } from "../helpers";

const fixture = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "fixtures", "greenhouse.json"), "utf8"),
) as { jobs: { id: number; title: string; location: { name: string } }[] };

const recipe = CompanyRecipeSchema.parse(recipeInput("databricks"));

function contextFor(http: FetchContext["http"]): FetchContext {
  return {
    http,
    signal: new AbortController().signal,
    keywords: [],
    maxPages: 1,
    knownExternalIds: new Set(),
    now: new Date("2026-11-21T00:00:00Z"),
  };
}

describe("greenhouse adapter", () => {
  it("requests the recipe URL once and maps every job in the saved real response", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(fixture));

    const { jobs, outcome } = await drainAdapter(greenhouseAdapter, recipe, contextFor(client));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(recipe.fetch?.url);
    expect(jobs).toHaveLength(fixture.jobs.length);
    expect(jobs.map((job) => job.externalId)).toEqual(fixture.jobs.map((job) => String(job.id)));
    expect(jobs.map((job) => job.title)).toEqual(fixture.jobs.map((job) => job.title));
    expect(jobs.map((job) => job.locationRaw)).toEqual(
      fixture.jobs.map((job) => job.location.name),
    );
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("returns absolute job URLs and ISO-like posted dates, so every job is valid", async () => {
    const { client } = fakeHttp(() => jsonResponse(fixture));

    const { jobs } = await drainAdapter(greenhouseAdapter, recipe, contextFor(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    for (const job of jobs) {
      expect(job.url).toMatch(/^https:\/\//);
      expect(typeof job.postedRaw).toBe("string");
    }
  });

  it("decodes the escaped HTML in content so it can be turned into a snippet", async () => {
    const { client } = fakeHttp(() => jsonResponse(fixture));

    const { jobs } = await drainAdapter(greenhouseAdapter, recipe, contextFor(client));

    expect(jobs[0]?.description).toContain("<p>");
    expect(jobs[0]?.description).not.toContain("&lt;");
  });

  it("keeps multi-location strings as the ATS gives them", async () => {
    const { client } = fakeHttp(() => jsonResponse(fixture));

    const { jobs } = await drainAdapter(greenhouseAdapter, recipe, contextFor(client));

    expect(jobs[0]?.locationRaw).toBe("Bengaluru, India; Mumbai, India");
  });

  it("yields entries it cannot read as empty jobs so the refresh service counts them invalid", async () => {
    const { client } = fakeHttp(() =>
      jsonResponse({ jobs: [{ title: "No id or url" }, fixture.jobs[0]] }),
    );

    const { jobs } = await drainAdapter(greenhouseAdapter, recipe, contextFor(client));

    expect(jobs).toHaveLength(2);
    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
  });

  it("fails clearly when the response has no jobs array", async () => {
    const { client } = fakeHttp(() => jsonResponse({ error: "board not found" }));

    await expect(drainAdapter(greenhouseAdapter, recipe, contextFor(client))).rejects.toThrow(
      /no jobs array/,
    );
  });

  it("sends the recipe headers and the company abort signal", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse({ jobs: [] }));
    const ctx = contextFor(client);
    const withHeaders = CompanyRecipeSchema.parse(
      recipeInput("databricks", {
        fetch: { url: recipe.fetch?.url, headers: { "accept-language": "en" } },
      }),
    );

    await drainAdapter(greenhouseAdapter, withHeaders, ctx);

    expect(requests[0]?.headers).toEqual({ "accept-language": "en" });
    expect(requests[0]?.signal).toBe(ctx.signal);
  });
});
