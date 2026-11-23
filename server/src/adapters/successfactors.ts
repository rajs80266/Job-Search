import { type CheerioAPI, load } from "cheerio";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { collapseWhitespace } from "../lib/text";
import { paginate } from "./paginate";
import { HTML_ACCEPT, UNREADABLE_JOB, requireFetchSpec, withQueryParams } from "./shared";

/** Rows per results page on SuccessFactors career sites. */
const DEFAULT_PAGE_SIZE = 25;

function readTotal($: CheerioAPI): number | null {
  const label = $(".paginationLabel").first().text();
  const match = /\bof\s+([\d,]+)/i.exec(label);
  return match?.[1] ? Number(match[1].replaceAll(",", "")) : null;
}

function parseRows($: CheerioAPI, searchUrl: string): FetchedJob[] {
  return $("tr.data-row")
    .toArray()
    .map((row) => {
      const link = $(row).find("a.jobTitle-link").first();
      const href = link.attr("href");
      if (!href) return UNREADABLE_JOB;

      const url = new URL(href, searchUrl).toString();
      const location = $(row).find(".jobLocation").first().clone();
      location.find("small").remove();
      return {
        externalId: /\/(\d+)\/?$/.exec(new URL(url).pathname)?.[1] ?? url,
        title: collapseWhitespace(link.text()),
        url,
        locationRaw: collapseWhitespace(location.text()),
        postedRaw: null,
        description: "",
      };
    });
}

/**
 * GET the career site's search page (HTML table, `/search/?q=&locationsearch=&startrow=`).
 * q = keyword, locationsearch = filters.location, startrow = paging. The listing has no
 * description or date, so the description comes from fetchDescription.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);

  return yield* paginate(recipe, ctx, async ({ keyword, fetchedSoFar }) => {
    const url = withQueryParams(fetchSpec.url, {
      q: keyword,
      locationsearch: recipe.filters.location,
      startrow: fetchedSoFar,
    });
    const response = await ctx.http.request({
      url,
      headers: { ...HTML_ACCEPT, ...fetchSpec.headers },
      signal: ctx.signal,
    });

    const $ = load(response.text);
    const jobs = parseRows($, url);
    const total = readTotal($);
    return {
      jobs,
      hasMore:
        jobs.length > 0 &&
        (total === null ? jobs.length >= DEFAULT_PAGE_SIZE : fetchedSoFar + jobs.length < total),
    };
  });
}

async function fetchDescription(
  job: FetchedJob,
  _recipe: CompanyRecipe,
  ctx: FetchContext,
): Promise<string> {
  const response = await ctx.http.request({
    url: job.url,
    headers: HTML_ACCEPT,
    signal: ctx.signal,
  });
  const $ = load(response.text);
  const description =
    $('[itemprop="description"]').first().html() ?? $(".jobdescription").first().html();
  if (!description) throw new Error("SuccessFactors job page has no description");
  return description;
}

export const successFactorsAdapter: Adapter = {
  ats: "successfactors",
  fetchJobs,
  fetchDescription,
};
