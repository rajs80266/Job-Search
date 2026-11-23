import { describe, expect, it } from "vitest";
import { drainAdapter } from "../../src/adapters/drain";
import { workableAdapter } from "../../src/adapters/workable";
import { validateAndDedupe } from "../../src/refresh/normalize";
import { CompanyRecipeSchema } from "../../src/types";
import { fakeHttp, fetchContext, jsonResponse, readJsonFixture, recipeInput } from "../helpers";

interface WidgetJob {
  title: string;
  shortcode: string;
  url: string;
  published_on: string;
  telecommuting: boolean;
  city: string;
  description: string;
}

const widget = readJsonFixture<{ jobs: WidgetJob[] }>("workable.json");

const recipe = CompanyRecipeSchema.parse(
  recipeInput("stadium", {
    ats: "workable",
    fetch: { url: "https://apply.workable.com/api/v1/widget/accounts/bystadium?details=true" },
  }),
);

function jobWithShortcode(shortcode: string): WidgetJob {
  const job = widget.jobs.find((candidate) => candidate.shortcode === shortcode);
  if (!job) throw new Error(`fixture has no job ${shortcode}`);
  return job;
}

describe("workable adapter", () => {
  it("requests the recipe URL once and maps every job in the saved real response", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(widget));

    const { jobs, outcome } = await drainAdapter(workableAdapter, recipe, fetchContext(client));

    expect(requests.map((req) => req.url)).toEqual([recipe.fetch?.url]);
    expect(jobs.map((job) => job.externalId)).toEqual(widget.jobs.map((job) => job.shortcode));
    expect(jobs.map((job) => job.title)).toEqual(widget.jobs.map((job) => job.title));
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 1 });
  });

  it("returns absolute URLs, ISO posting dates and the HTML description", async () => {
    const { client } = fakeHttp(() => jsonResponse(widget));

    const { jobs } = await drainAdapter(workableAdapter, recipe, fetchContext(client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 0 });
    expect(jobs.map((job) => job.url)).toEqual(widget.jobs.map((job) => job.url));
    expect(jobs.map((job) => job.postedRaw)).toEqual(widget.jobs.map((job) => job.published_on));
    expect(jobs.map((job) => job.description)).toEqual(widget.jobs.map((job) => job.description));
  });

  it("builds the location from the job's address and marks remote jobs", async () => {
    const { client } = fakeHttp(() => jsonResponse(widget));

    const { jobs } = await drainAdapter(workableAdapter, recipe, fetchContext(client));
    const locationOf = (shortcode: string) =>
      jobs.find((job) => job.externalId === shortcode)?.locationRaw;

    const remoteCountryOnly = widget.jobs.find((job) => job.telecommuting && job.city === "");
    const inOffice = widget.jobs.find((job) => !job.telecommuting);
    expect(locationOf(remoteCountryOnly?.shortcode ?? "")).toBe("India | Remote");
    expect(locationOf(inOffice?.shortcode ?? "")).toBe("New Delhi, Delhi, India");
  });

  it("joins several locations of one job", async () => {
    const multi = {
      ...jobWithShortcode(widget.jobs[0]?.shortcode ?? ""),
      telecommuting: false,
      locations: [
        { city: "Pune", region: "Maharashtra", country: "India" },
        { city: "Mumbai", region: "Maharashtra", country: "India" },
      ],
    };
    const { client } = fakeHttp(() => jsonResponse({ jobs: [multi] }));

    const { jobs } = await drainAdapter(workableAdapter, recipe, fetchContext(client));

    expect(jobs[0]?.locationRaw).toBe("Pune, Maharashtra, India | Mumbai, Maharashtra, India");
  });

  it("yields jobs it cannot read as empty jobs and fails clearly without a jobs array", async () => {
    const broken = fakeHttp(() =>
      jsonResponse({ jobs: [{ title: "No shortcode" }, widget.jobs[0]] }),
    );
    const noJobs = fakeHttp(() => jsonResponse({ error: "not found" }));

    const { jobs } = await drainAdapter(workableAdapter, recipe, fetchContext(broken.client));

    expect(validateAndDedupe(jobs)).toMatchObject({ invalid: 1 });
    await expect(
      drainAdapter(workableAdapter, recipe, fetchContext(noJobs.client)),
    ).rejects.toThrow(/no jobs array/);
  });
});
