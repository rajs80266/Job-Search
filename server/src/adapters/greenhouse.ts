import { z } from "zod";
import { decodeHtmlEntities } from "../lib/text";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { UNREADABLE_JOB, requireFetchSpec } from "./shared";

const GreenhouseJobSchema = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string() }).nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  /** HTML-escaped HTML, present when the URL has content=true. */
  content: z.string().nullish(),
});

const GreenhouseResponseSchema = z.object({ jobs: z.array(z.unknown()) });

function toFetchedJob(entry: unknown): FetchedJob {
  const parsed = GreenhouseJobSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const job = parsed.data;
  return {
    externalId: String(job.id),
    title: job.title,
    url: job.absolute_url,
    locationRaw: job.location?.name ?? "",
    postedRaw: job.first_published ?? job.updated_at ?? null,
    description: decodeHtmlEntities(job.content ?? ""),
  };
}

/**
 * Public boards API: one GET returns every job, so the fetch is always complete.
 * recipe.fetch.url is sent as written (use `?content=true` to get descriptions).
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

  const body = GreenhouseResponseSchema.safeParse(response.json());
  if (!body.success) throw new Error("Unexpected Greenhouse response: no jobs array");

  for (const entry of body.data.jobs) yield toFetchedJob(entry);
  return { complete: true, stopReason: "end", pagesFetched: 1 };
}

export const greenhouseAdapter: Adapter = { ats: "greenhouse", fetchJobs };
