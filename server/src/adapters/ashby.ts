import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { UNREADABLE_JOB, joinLocations, requireFetchSpec, withCountry } from "./shared";

const PlaceSchema = z.object({
  location: z.string().nullish(),
  address: z
    .object({ postalAddress: z.object({ addressCountry: z.string().nullish() }).nullish() })
    .nullish(),
});

const JobSchema = PlaceSchema.extend({
  id: z.string(),
  title: z.string(),
  jobUrl: z.string(),
  publishedAt: z.string().nullish(),
  isListed: z.boolean().nullish(),
  secondaryLocations: z.array(PlaceSchema).nullish(),
  descriptionHtml: z.string().nullish(),
});

const BoardResponseSchema = z.object({ jobs: z.array(z.unknown()) });

function placeText(place: z.infer<typeof PlaceSchema>): string {
  return withCountry(place.location ?? "", place.address?.postalAddress?.addressCountry);
}

function toFetchedJob(entry: unknown): FetchedJob | null {
  const parsed = JobSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const job = parsed.data;
  if (job.isListed === false) return null;
  return {
    externalId: job.id,
    title: job.title,
    url: job.jobUrl,
    locationRaw: joinLocations([job, ...(job.secondaryLocations ?? [])].map(placeText)),
    postedRaw: job.publishedAt ?? null,
    description: job.descriptionHtml ?? "",
  };
}

/**
 * Public job-board API: one GET returns every listed job (with descriptions), so the fetch is
 * always complete. Ashby has no keyword or location parameters; scoring does the filtering.
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

  const board = BoardResponseSchema.safeParse(response.json());
  if (!board.success) throw new Error("Unexpected Ashby response: no jobs array");

  for (const entry of board.data.jobs) {
    const job = toFetchedJob(entry);
    if (job) yield job;
  }
  return { complete: true, stopReason: "end", pagesFetched: 1 };
}

export const ashbyAdapter: Adapter = { ats: "ashby", fetchJobs };
