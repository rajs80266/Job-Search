import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { paginate } from "./paginate";
import {
  UNREADABLE_JOB,
  joinAddressParts,
  joinLocations,
  requireFetchSpec,
  withQueryParams,
} from "./shared";

/** The API's maximum. */
const MAX_PAGE_SIZE = 100;

const PostingSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  location: z
    .object({
      fullLocation: z.string().nullish(),
      city: z.string().nullish(),
      remote: z.boolean().nullish(),
    })
    .nullish(),
});

const ListResponseSchema = z.object({
  totalFound: z.number(),
  content: z.array(z.unknown()),
});

const DetailResponseSchema = z.object({
  jobAd: z.object({
    sections: z.record(z.string(), z.object({ text: z.string().nullish() }).nullish()),
  }),
});

/** Company-wide boilerplate sections are left out so they cannot drown the job's own text. */
const DESCRIPTION_SECTIONS = ["jobDescription", "qualifications"];

function companyIdOf(listUrl: string): string {
  const segments = new URL(listUrl).pathname.split("/");
  const companyId = segments[segments.indexOf("companies") + 1];
  if (!companyId) throw new Error("SmartRecruiters fetch.url has no /companies/<id>/ segment");
  return companyId;
}

/** fullLocation looks like "Hyderabad, , India" when the region is empty. */
function locationOf(posting: z.infer<typeof PostingSchema>): string {
  const location = posting.location;
  const place = joinAddressParts((location?.fullLocation ?? location?.city ?? "").split(","));
  return joinLocations([place, ...(location?.remote ? ["Remote"] : [])]);
}

function toFetchedJob(entry: unknown, companyId: string): FetchedJob {
  const parsed = PostingSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const posting = parsed.data;
  return {
    externalId: posting.id,
    title: posting.name,
    url: `https://jobs.smartrecruiters.com/${companyId}/${posting.id}`,
    locationRaw: locationOf(posting),
    postedRaw: posting.releasedDate ?? null,
    description: "",
    detailRef: posting.id,
  };
}

/**
 * GET `api.smartrecruiters.com/v1/companies/<id>/postings`. Sends each keyword as `q`,
 * `filters.location` as `country` (a lower-case ISO code such as "in"), and pages with
 * offset/limit (max 100). Results come newest first.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const companyId = companyIdOf(fetchSpec.url);
  const pageSize = Math.min(fetchSpec.pagination.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);

  return yield* paginate(recipe, ctx, async ({ keyword, fetchedSoFar }) => {
    const response = await ctx.http.request({
      url: withQueryParams(fetchSpec.url, {
        q: keyword,
        country: recipe.filters.location,
        offset: fetchedSoFar,
        limit: pageSize,
      }),
      headers: fetchSpec.headers,
      signal: ctx.signal,
    });

    const list = ListResponseSchema.safeParse(response.json());
    if (!list.success) throw new Error("Unexpected SmartRecruiters response: no content array");

    const { content, totalFound } = list.data;
    return {
      jobs: content.map((entry) => toFetchedJob(entry, companyId)),
      hasMore: content.length > 0 && fetchedSoFar + content.length < totalFound,
    };
  });
}

/** GET `<postings url>/<id>`: the listing has no description, the detail has `jobAd.sections`. */
async function fetchDescription(
  job: FetchedJob,
  recipe: CompanyRecipe,
  ctx: FetchContext,
): Promise<string> {
  const { origin, pathname } = new URL(requireFetchSpec(recipe).url);
  const response = await ctx.http.request({
    url: `${origin}${pathname.replace(/\/$/, "")}/${job.detailRef ?? job.externalId}`,
    signal: ctx.signal,
  });

  const detail = DetailResponseSchema.safeParse(response.json());
  if (!detail.success)
    throw new Error("Unexpected SmartRecruiters job response: no jobAd sections");

  return DESCRIPTION_SECTIONS.map((name) => detail.data.jobAd.sections[name]?.text ?? "")
    .filter(Boolean)
    .join("\n");
}

export const smartRecruitersAdapter: Adapter = {
  ats: "smartrecruiters",
  fetchJobs,
  fetchDescription,
};
