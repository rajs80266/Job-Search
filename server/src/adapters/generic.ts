import { getPath, renderTemplate, replaceInStrings, setPath, toText } from "../lib/dot-path";
import {
  type Adapter,
  type CompanyRecipe,
  type FetchContext,
  type FetchSpec,
  type FetchedJob,
  type FetchOutcome,
  type FieldMap,
  KEYWORD_PLACEHOLDER,
} from "../types";
import { paginate } from "./paginate";
import { requireFetchSpec, withQueryParams } from "./shared";

type PagingEntry = [name: string, value: number];

/** The page/offset parameter, plus the page size parameter when the recipe sets both. */
function pagingEntries(
  pagination: FetchSpec["pagination"],
  pageIndex: number,
  fetchedSoFar: number,
): PagingEntry[] {
  if (!pagination.param) return [];

  let value: number;
  if (pagination.type === "offset") value = (pagination.start ?? 0) + fetchedSoFar;
  else if (pagination.type === "page") value = (pagination.start ?? 1) + pageIndex;
  else return [];

  const entries: PagingEntry[] = [[pagination.param, value]];
  if (pagination.sizeParam && pagination.pageSize !== undefined) {
    entries.push([pagination.sizeParam, pagination.pageSize]);
  }
  return entries;
}

/** GET: paging goes into query parameters. POST: the names are dot paths into the JSON body. */
function buildRequest(fetchSpec: FetchSpec, keyword: string, paging: PagingEntry[]) {
  const url = fetchSpec.url.split(KEYWORD_PLACEHOLDER).join(encodeURIComponent(keyword));
  if (fetchSpec.method === "GET") {
    return { url: withQueryParams(url, Object.fromEntries(paging)), method: "GET" as const };
  }

  const body = replaceInStrings(fetchSpec.body ?? {}, KEYWORD_PLACEHOLDER, keyword);
  for (const [path, value] of paging) setPath(body, path, value);
  return { url, method: "POST" as const, body };
}

function resolveUrl(rawUrl: string, baseUrl: string): string {
  if (rawUrl === "") return "";
  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return "";
  }
}

function postedRawFrom(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toFetchedJob(entry: unknown, fieldMap: FieldMap, baseUrl: string): FetchedJob {
  const rawUrl =
    fieldMap.urlTemplate === undefined
      ? toText(getPath(entry, fieldMap.url ?? ""))
      : renderTemplate(fieldMap.urlTemplate, entry);

  return {
    externalId: toText(getPath(entry, fieldMap.externalId)),
    title: toText(getPath(entry, fieldMap.title)),
    url: resolveUrl(rawUrl, baseUrl),
    locationRaw: fieldMap.location ? toText(getPath(entry, fieldMap.location)) : "",
    postedRaw: fieldMap.postedAt ? postedRawFrom(getPath(entry, fieldMap.postedAt)) : null,
    description: fieldMap.description ? toText(getPath(entry, fieldMap.description)) : "",
  };
}

function readTotal(response: unknown, fieldMap: FieldMap): number | null {
  if (!fieldMap.totalPath) return null;
  const total = Number(getPath(response, fieldMap.totalPath));
  return Number.isFinite(total) ? total : null;
}

/**
 * Any JSON listing API, described by the recipe: fetch.url/body (with `{{keyword}}`),
 * fetch.pagination (offset or page parameter) and fieldMap (dot paths into the response).
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const { fieldMap } = recipe;
  if (!fieldMap) throw new Error(`${recipe.slug} has no fieldMap`);
  const { pagination } = fetchSpec;

  return yield* paginate(recipe, ctx, async ({ keyword, pageIndex, fetchedSoFar }) => {
    const request = buildRequest(
      fetchSpec,
      keyword ?? "",
      pagingEntries(pagination, pageIndex, fetchedSoFar),
    );
    const response = await ctx.http.request({
      ...request,
      headers: fetchSpec.headers,
      signal: ctx.signal,
    });

    const body = response.json();
    const total = readTotal(body, fieldMap);
    // Some APIs (SuccessFactors search) omit the jobs array when nothing matches or the page is past the end.
    const entries = getPath(body, fieldMap.jobsPath) ?? (total === 0 ? [] : undefined);
    if (!Array.isArray(entries)) {
      throw new Error(`Unexpected response: no jobs array at "${fieldMap.jobsPath}"`);
    }

    const isFullPage = pagination.pageSize === undefined || entries.length >= pagination.pageSize;
    return {
      jobs: entries.map((entry) => toFetchedJob(entry, fieldMap, request.url)),
      hasMore:
        pagination.type !== "none" &&
        entries.length > 0 &&
        (total === null ? isFullPage : fetchedSoFar + entries.length < total),
    };
  });
}

export const genericAdapter: Adapter = { ats: "generic", fetchJobs };
