import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { paginate } from "./paginate";
import { UNREADABLE_JOB, requireFetchSpec, withQueryParams } from "./shared";

/** Larger values are rejected by the API. */
const MAX_PAGE_SIZE = 10;

const PositionSchema = z.object({
  id: z.union([z.number(), z.string()]),
  name: z.string(),
  location: z.string().nullish(),
  locations: z.array(z.string()).nullish(),
  /** Epoch seconds. */
  t_create: z.number().nullish(),
  canonicalPositionUrl: z.string().nullish(),
  /** Empty in the listing on most sites; the detail request has it. */
  job_description: z.string().nullish(),
});

const ListResponseSchema = z.object({
  count: z.number().nullish(),
  positions: z.array(z.unknown()),
});

const DetailResponseSchema = z.object({ job_description: z.string() });

function toFetchedJob(entry: unknown, origin: string): FetchedJob {
  const parsed = PositionSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const position = parsed.data;
  const locations = position.locations?.length ? position.locations : [position.location ?? ""];
  return {
    externalId: String(position.id),
    title: position.name,
    url: position.canonicalPositionUrl ?? `${origin}/careers/job/${position.id}`,
    locationRaw: locations.filter(Boolean).join(" | "),
    postedRaw: position.t_create ?? null,
    description: position.job_description ?? "",
    detailRef: String(position.id),
  };
}

/**
 * GET `<host>/api/apply/v2/jobs?domain=...`. The recipe URL is sent as written; only query
 * (keyword), start, num and - when set - filters.location are overridden.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const { origin } = new URL(fetchSpec.url);
  const pageSize = Math.min(fetchSpec.pagination.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);

  return yield* paginate(recipe, ctx, async ({ keyword, fetchedSoFar }) => {
    const response = await ctx.http.request({
      url: withQueryParams(fetchSpec.url, {
        query: keyword,
        location: recipe.filters.location,
        start: fetchedSoFar,
        num: pageSize,
      }),
      headers: fetchSpec.headers,
      signal: ctx.signal,
    });

    const list = ListResponseSchema.safeParse(response.json());
    if (!list.success) throw new Error("Unexpected Eightfold response: no positions array");

    const { positions, count } = list.data;
    return {
      jobs: positions.map((entry) => toFetchedJob(entry, origin)),
      hasMore:
        positions.length > 0 &&
        (count === null || count === undefined
          ? positions.length >= pageSize
          : fetchedSoFar + positions.length < count),
    };
  });
}

/** GET `<host>/api/apply/v2/jobs/<id>?domain=...` */
async function fetchDescription(
  job: FetchedJob,
  recipe: CompanyRecipe,
  ctx: FetchContext,
): Promise<string> {
  const listUrl = new URL(requireFetchSpec(recipe).url);
  const domain = listUrl.searchParams.get("domain");
  if (!domain) throw new Error("Eightfold fetch.url has no domain parameter");

  const response = await ctx.http.request({
    url: withQueryParams(
      `${listUrl.origin}${listUrl.pathname}/${job.detailRef ?? job.externalId}`,
      {
        domain,
      },
    ),
    signal: ctx.signal,
  });
  const detail = DetailResponseSchema.safeParse(response.json());
  if (!detail.success) throw new Error("Unexpected Eightfold job response: no job_description");
  return detail.data.job_description;
}

export const eightfoldAdapter: Adapter = { ats: "eightfold", fetchJobs, fetchDescription };
