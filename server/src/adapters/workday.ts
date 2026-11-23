import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { paginate } from "./paginate";
import { UNREADABLE_JOB, requireFetchSpec } from "./shared";

/** Workday rejects larger pages. */
const MAX_PAGE_SIZE = 20;

const PostingSchema = z.object({
  title: z.string(),
  externalPath: z.string(),
  locationsText: z.string().nullish(),
  /** "Posted Today", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
  postedOn: z.string().nullish(),
  /** The first entry is the requisition ID on standard sites; some tenants put the city second. */
  bulletFields: z.array(z.string()).nullish(),
});

const ListResponseSchema = z.object({
  /** Only sent with the first page (0 on later pages). */
  total: z.number().nullish(),
  jobPostings: z.array(z.unknown()),
});

const DetailResponseSchema = z.object({
  jobPostingInfo: z.object({ jobDescription: z.string() }),
});

interface WorkdaySite {
  origin: string;
  tenant: string;
  site: string;
}

/** The listing URL is `https://<host>/wday/cxs/<tenant>/<site>/jobs`. */
function parseSite(listUrl: string): WorkdaySite {
  const url = new URL(listUrl);
  const [wday, cxs, tenant, site] = url.pathname.split("/").filter(Boolean);
  if (wday !== "wday" || cxs !== "cxs" || !tenant || !site) {
    throw new Error(
      `Not a Workday listing URL (expected /wday/cxs/<tenant>/<site>/jobs): ${listUrl}`,
    );
  }
  return { origin: url.origin, tenant, site };
}

/** What Workday shows instead of the places when a job has several. */
const MULTI_LOCATION_PLACEHOLDER = /^\d+ locations?$/i;

/**
 * `locationsText`, or the city in `bulletFields[1]` when the tenant omits it (Accenture).
 * The "2 Locations" placeholder is unknown, not a place.
 */
function locationOf(posting: z.infer<typeof PostingSchema>): string {
  const text = posting.locationsText?.trim() ?? "";
  if (text === "") return posting.bulletFields?.[1]?.trim() ?? "";
  return MULTI_LOCATION_PLACEHOLDER.test(text) ? "" : text;
}

function toFetchedJob(entry: unknown, { origin, site }: WorkdaySite): FetchedJob {
  const parsed = PostingSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const posting = parsed.data;
  return {
    externalId: posting.bulletFields?.[0] ?? posting.externalPath,
    title: posting.title,
    url: `${origin}/${site}${posting.externalPath}`,
    locationRaw: locationOf(posting),
    postedRaw: posting.postedOn ?? null,
    description: "",
    detailRef: posting.externalPath,
  };
}

/**
 * POST `<host>/wday/cxs/<tenant>/<site>/jobs`. The recipe body (with its location facets) is sent
 * as written; only searchText, limit and offset are set here. The listing has no description.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const site = parseSite(fetchSpec.url);
  const limit = Math.min(fetchSpec.pagination.pageSize ?? MAX_PAGE_SIZE, MAX_PAGE_SIZE);
  const totalByKeyword = new Map<string, number>();

  return yield* paginate(recipe, ctx, async ({ keyword, fetchedSoFar }) => {
    const body = {
      ...fetchSpec.body,
      limit,
      offset: fetchedSoFar,
      ...(keyword === null ? {} : { searchText: keyword }),
    };
    const response = await ctx.http.request({
      url: fetchSpec.url,
      method: "POST",
      headers: fetchSpec.headers,
      body,
      signal: ctx.signal,
    });

    const list = ListResponseSchema.safeParse(response.json());
    if (!list.success) throw new Error("Unexpected Workday response: no jobPostings array");

    const totalKey = keyword ?? "";
    if (fetchedSoFar === 0) totalByKeyword.set(totalKey, list.data.total ?? 0);
    const total = totalByKeyword.get(totalKey) ?? 0;

    const postings = list.data.jobPostings;
    const reachedTotal = total > 0 && fetchedSoFar + postings.length >= total;
    return {
      jobs: postings.map((entry) => toFetchedJob(entry, site)),
      hasMore: postings.length >= limit && !reachedTotal,
    };
  });
}

async function fetchDescription(
  job: FetchedJob,
  recipe: CompanyRecipe,
  ctx: FetchContext,
): Promise<string> {
  if (!job.detailRef) throw new Error("Workday job has no detailRef");

  const { origin, tenant, site } = parseSite(requireFetchSpec(recipe).url);
  const response = await ctx.http.request({
    url: `${origin}/wday/cxs/${tenant}/${site}${job.detailRef}`,
    signal: ctx.signal,
  });
  const detail = DetailResponseSchema.safeParse(response.json());
  if (!detail.success) throw new Error("Unexpected Workday job response: no jobDescription");
  return detail.data.jobPostingInfo.jobDescription;
}

export const workdayAdapter: Adapter = { ats: "workday", fetchJobs, fetchDescription };
