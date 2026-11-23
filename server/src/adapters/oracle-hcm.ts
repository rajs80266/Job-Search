import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { paginate } from "./paginate";
import { UNREADABLE_JOB, requireFetchSpec } from "./shared";

const DEFAULT_PAGE_SIZE = 25;
const CANDIDATE_EXPERIENCE_LANGUAGE = "en";
const REQUISITION_EXPANSION = "requisitionList.secondaryLocations";

const RequisitionSchema = z.object({
  Id: z.union([z.number(), z.string()]),
  Title: z.string(),
  /** YYYY-MM-DD. */
  PostedDate: z.string().nullish(),
  PrimaryLocation: z.string().nullish(),
  secondaryLocations: z.array(z.object({ Name: z.string() })).nullish(),
  /** A short summary, not the full posting. */
  ShortDescriptionStr: z.string().nullish(),
});

const ListResponseSchema = z.object({
  items: z.array(
    z.object({
      TotalJobsCount: z.number().nullish(),
      requisitionList: z.array(z.unknown()).nullish(),
    }),
  ),
});

/**
 * The finder looks like `findReqs;siteNumber=CX_1001,limit=25,offset=0,keyword=abc`. It is edited
 * as raw text because it mixes `;` `,` `=` and %-escapes that URLSearchParams would re-encode.
 */
const FINDER_PARAMETER = /([?&]finder=)([^&]*)/;

function readFinder(rawUrl: string): { name: string; params: string[] } {
  const rawFinder = FINDER_PARAMETER.exec(rawUrl)?.[2];
  if (!rawFinder) throw new Error("Oracle HCM fetch.url has no finder parameter");

  const separator = rawFinder.indexOf(";");
  if (separator === -1) return { name: rawFinder, params: [] };
  return {
    name: rawFinder.slice(0, separator),
    params: rawFinder
      .slice(separator + 1)
      .split(",")
      .filter(Boolean),
  };
}

/** Sets the given finder parameters; `null`/`undefined` values leave the recipe's own value alone. */
function setFinderParams(
  rawUrl: string,
  overrides: Record<string, string | number | null | undefined>,
): string {
  const { name, params } = readFinder(rawUrl);
  const active = Object.entries(overrides).filter(
    ([, value]) => value !== null && value !== undefined,
  );
  const overriddenNames = new Set(active.map(([key]) => key));
  const kept = params.filter((param) => !overriddenNames.has(param.split("=")[0] ?? ""));
  const added = active.map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);

  const finder = `${name};${[...kept, ...added].join(",")}`;
  return rawUrl.replace(FINDER_PARAMETER, (_match, prefix: string) => `${prefix}${finder}`);
}

function readFinderParam(rawUrl: string, key: string): string | undefined {
  return readFinder(rawUrl)
    .params.find((param) => param.startsWith(`${key}=`))
    ?.slice(key.length + 1);
}

function withRequisitionExpansion(rawUrl: string): string {
  return /[?&]expand=/.test(rawUrl) ? rawUrl : `${rawUrl}&expand=${REQUISITION_EXPANSION}`;
}

function toFetchedJob(entry: unknown, origin: string, siteNumber: string): FetchedJob {
  const parsed = RequisitionSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const requisition = parsed.data;
  const locations = [
    requisition.PrimaryLocation ?? "",
    ...(requisition.secondaryLocations ?? []).map((location) => location.Name),
  ].filter(Boolean);
  return {
    externalId: String(requisition.Id),
    title: requisition.Title,
    url: `${origin}/hcmUI/CandidateExperience/${CANDIDATE_EXPERIENCE_LANGUAGE}/sites/${siteNumber}/job/${requisition.Id}`,
    locationRaw: locations.join(" | "),
    postedRaw: requisition.PostedDate ?? null,
    description: requisition.ShortDescriptionStr ?? "",
  };
}

/**
 * GET `<host>/hcmRestApi/resources/latest/recruitingCEJobRequisitions?finder=findReqs;siteNumber=...`.
 * The recipe URL is sent as written; limit, offset, keyword and (when set) filters.location
 * as locationId are set inside the finder. The listing only carries a short summary, which is
 * enough to score on, so there is no per-job description request.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const baseUrl = withRequisitionExpansion(fetchSpec.url);
  const { origin } = new URL(baseUrl);
  const siteNumber = readFinderParam(baseUrl, "siteNumber");
  if (!siteNumber) throw new Error("Oracle HCM finder has no siteNumber");
  const limit = fetchSpec.pagination.pageSize ?? DEFAULT_PAGE_SIZE;

  return yield* paginate(recipe, ctx, async ({ keyword, fetchedSoFar }) => {
    const response = await ctx.http.request({
      url: setFinderParams(baseUrl, {
        limit,
        offset: fetchedSoFar,
        keyword,
        locationId: recipe.filters.location,
      }),
      headers: fetchSpec.headers,
      signal: ctx.signal,
    });

    const list = ListResponseSchema.safeParse(response.json());
    const search = list.success ? list.data.items[0] : undefined;
    if (!search?.requisitionList) {
      throw new Error("Unexpected Oracle HCM response: no requisitionList in items[0]");
    }

    const requisitions = search.requisitionList;
    return {
      jobs: requisitions.map((entry) => toFetchedJob(entry, origin, siteNumber)),
      // The response's own `hasMore` describes the single search item, not the jobs.
      hasMore:
        requisitions.length > 0 &&
        fetchedSoFar + requisitions.length < (search.TotalJobsCount ?? 0),
    };
  });
}

export const oracleHcmAdapter: Adapter = { ats: "oracle-hcm", fetchJobs };
