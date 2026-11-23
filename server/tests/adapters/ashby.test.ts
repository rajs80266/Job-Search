import { describe, expect, it } from "vitest";
import { ashbyAdapter } from "../../src/adapters/ashby";
import { drainAdapter } from "../../src/adapters/drain";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, jsonResponse, readJsonFixture, recipeInput } from "../helpers";

interface AshbyJob {
  id: string;
  title: string;
  location: string;
  publishedAt: string;
  jobUrl: string;
  descriptionHtml: string;
}

const board = readJsonFixture<{ jobs: AshbyJob[] }>("ashby.json");

const recipe = CompanyRecipeSchema.parse(
  recipeInput("sarvam", {
    ats: "ashby",
    fetch: { url: "https://api.ashbyhq.com/posting-api/job-board/sarvam" },
  }),
);

describe("ashby adapter", () => {
  it("requests the recipe URL once and maps every job in the saved real response", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(board));

    const { jobs, outcome } = await drainAdapter(ashbyAdapter, recipe, fetchContext(client));

    expect(requests.map((req) => req.url)).toEqual([recipe.fetch?.url]);
    expect(jobs.map((job) => job.externalId)).toEqual(board.jobs.map((job) => job.id));
    expect(jobs.map((job) => job.title)).toEqual(board.jobs.map((job) => job.title));
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("returns absolute URLs, ISO posting dates and the HTML description", async () => {
    const { client } = fakeHttp(() => jsonResponse(board));

    const { jobs } = await drainAdapter(ashbyAdapter, recipe, fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs.map((job) => job.url)).toEqual(board.jobs.map((job) => job.jobUrl));
    expect(jobs.map((job) => job.postedRaw)).toEqual(board.jobs.map((job) => job.publishedAt));
    expect(jobs[0]?.description).toBe(board.jobs[0]?.descriptionHtml);
  });

  it("adds the address country to the location name", async () => {
    const { client } = fakeHttp(() => jsonResponse(board));

    const { jobs } = await drainAdapter(ashbyAdapter, recipe, fetchContext(client));

    expect(jobs.map((job) => job.locationRaw)).toEqual(
      board.jobs.map((job) => `${job.location}, India`),
    );
  });

  it("joins secondary locations and does not repeat a country the name already has", async () => {
    const first = board.jobs[0];
    const withSecondary = {
      ...first,
      location: "Bengaluru, India",
      secondaryLocations: [
        { location: "Pune", address: { postalAddress: { addressCountry: "India" } } },
        { location: "Remote" },
      ],
    };
    const { client } = fakeHttp(() => jsonResponse({ jobs: [withSecondary] }));

    const { jobs } = await drainAdapter(ashbyAdapter, recipe, fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Bengaluru, India | Pune, India | Remote");
  });

  it("skips jobs that are not listed", async () => {
    const hidden = { ...board.jobs[0], id: "hidden", isListed: false };
    const { client } = fakeHttp(() => jsonResponse({ jobs: [hidden, board.jobs[1]] }));

    const { jobs } = await drainAdapter(ashbyAdapter, recipe, fetchContext(client));

    expect(jobs.map((job) => job.externalId)).toEqual([board.jobs[1]?.id]);
  });

  it("yields jobs it cannot read as empty jobs and fails clearly without a jobs array", async () => {
    const broken = fakeHttp(() => jsonResponse({ jobs: [{ title: "No id" }, board.jobs[0]] }));
    const noJobs = fakeHttp(() => jsonResponse({ message: "not found" }));

    const { jobs } = await drainAdapter(ashbyAdapter, recipe, fetchContext(broken.client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
    await expect(drainAdapter(ashbyAdapter, recipe, fetchContext(noJobs.client))).rejects.toThrow(
      /no jobs array/,
    );
  });
});
