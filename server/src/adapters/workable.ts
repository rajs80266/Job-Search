import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { UNREADABLE_JOB, joinAddressParts, joinLocations, requireFetchSpec } from "./shared";

const PlaceSchema = z.object({
  city: z.string().nullish(),
  region: z.string().nullish(),
  state: z.string().nullish(),
  country: z.string().nullish(),
});

const JobSchema = PlaceSchema.extend({
  shortcode: z.string(),
  title: z.string(),
  url: z.string(),
  /** "YYYY-MM-DD". */
  published_on: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  locations: z.array(PlaceSchema).nullish(),
  /** HTML; only present when the URL has details=true. */
  description: z.string().nullish(),
});

const WidgetResponseSchema = z.object({ jobs: z.array(z.unknown()) });

function addressOf(place: z.infer<typeof PlaceSchema>): string {
  return joinAddressParts([place.city, place.region ?? place.state, place.country]);
}

function locationOf(job: z.infer<typeof JobSchema>): string {
  const places = job.locations?.length ? job.locations : [job];
  return joinLocations([...places.map(addressOf), ...(job.telecommuting ? ["Remote"] : [])]);
}

function toFetchedJob(entry: unknown): FetchedJob {
  const parsed = JobSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const job = parsed.data;
  return {
    externalId: job.shortcode,
    title: job.title,
    url: job.url,
    locationRaw: locationOf(job),
    postedRaw: job.published_on ?? null,
    description: job.description ?? "",
  };
}

/**
 * Public widget API: one GET returns every job, so the fetch is always complete. It has no
 * keyword or location parameters (scoring filters); use `?details=true` in fetch.url to get
 * descriptions.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);

  const response = await ctx.http.request({
    url: fetchSpec.url,
    headers: fetchSpec.headers,
    signal: ctx.signal,
  });

  const widget = WidgetResponseSchema.safeParse(response.json());
  if (!widget.success) throw new Error("Unexpected Workable response: no jobs array");

  for (const entry of widget.data.jobs) yield toFetchedJob(entry);
  return { complete: true, stopReason: "end", pagesFetched: 1 };
}

export const workableAdapter: Adapter = { ats: "workable", fetchJobs };
