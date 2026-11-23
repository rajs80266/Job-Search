import type { CompanyRecipe, FetchContext, FetchOutcome, FetchedJob, PageResult } from "../types";

export interface PageRequest {
  /** null = one unfiltered query. */
  keyword: string | null;
  /** 0-based within this keyword's query. */
  pageIndex: number;
  /** Jobs returned by earlier pages of this query (use it as the next offset). */
  fetchedSoFar: number;
}

export type FetchPage = (request: PageRequest) => Promise<PageResult>;

/**
 * The shared paging rules (ARCHITECTURE §3): one query per keyword, stop at the end, at
 * ctx.maxPages, or - only for newest-first recipes - after a page of already known jobs.
 * Jobs are yielded as pages arrive and de-duplicated by externalId across queries.
 */
export async function* paginate(
  recipe: CompanyRecipe,
  ctx: FetchContext,
  fetchPage: FetchPage,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const keywords = ctx.keywords.length > 0 ? ctx.keywords : [null];
  const canStopEarly =
    recipe.fetch?.pagination.sortedNewestFirst === true && ctx.knownExternalIds.size > 0;
  const seenExternalIds = new Set<string>();
  let pagesFetched = 0;
  let hitPageCap = false;
  let stoppedOnKnownIds = false;

  for (const keyword of keywords) {
    let fetchedSoFar = 0;

    for (let pageIndex = 0; ; pageIndex++) {
      ctx.signal.throwIfAborted();
      const page = await fetchPage({ keyword, pageIndex, fetchedSoFar });
      pagesFetched++;
      fetchedSoFar += page.jobs.length;

      for (const job of page.jobs) {
        if (job.externalId !== "") {
          if (seenExternalIds.has(job.externalId)) continue;
          seenExternalIds.add(job.externalId);
        }
        yield job;
      }

      if (!page.hasMore) break;
      if (canStopEarly && isEntirelyKnown(page.jobs, ctx.knownExternalIds)) {
        stoppedOnKnownIds = true;
        break;
      }
      if (pageIndex + 1 >= ctx.maxPages) {
        hitPageCap = true;
        break;
      }
    }
  }

  const stopReason = hitPageCap ? "page-cap" : stoppedOnKnownIds ? "known-ids" : "end";
  return { complete: stopReason === "end", stopReason, pagesFetched };
}

function isEntirelyKnown(jobs: readonly FetchedJob[], known: ReadonlySet<string>): boolean {
  return jobs.length > 0 && jobs.every((job) => known.has(job.externalId));
}
