import { describe, expect, it } from "vitest";
import { type FetchPage, paginate } from "../../src/adapters/paginate";
import { CompanyRecipeSchema, type FetchContext, type PageResult } from "../../src/types";
import { fetchContext, fakeHttp, jsonResponse, makeJob, recipeInput } from "../helpers";

function recipeWith(sortedNewestFirst: boolean) {
  return CompanyRecipeSchema.parse(
    recipeInput("acme", {
      fetch: {
        url: "https://jobs.example/api",
        pagination: { maxPages: 5, sortedNewestFirst },
      },
    }),
  );
}

const { client } = fakeHttp(() => jsonResponse({}));

function page(ids: string[], hasMore: boolean): PageResult {
  return { jobs: ids.map((id) => makeJob(id)), hasMore };
}

/** Pages per keyword; the last page of the list has hasMore=false unless `endlessly`. */
function scriptedPages(pagesByKeyword: Record<string, string[][]>, endlessly = false) {
  const requests: { keyword: string | null; pageIndex: number; fetchedSoFar: number }[] = [];
  const fetchPage: FetchPage = (request) => {
    requests.push(request);
    const pages = pagesByKeyword[request.keyword ?? ""] ?? [];
    const ids = pages[request.pageIndex] ?? [];
    return Promise.resolve(page(ids, endlessly || request.pageIndex + 1 < pages.length));
  };
  return { fetchPage, requests };
}

async function run(
  sortedNewestFirst: boolean,
  ctxOverrides: Partial<FetchContext>,
  fetchPage: FetchPage,
) {
  const generator = paginate(
    recipeWith(sortedNewestFirst),
    fetchContext(client, ctxOverrides),
    fetchPage,
  );
  const ids: string[] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) return { ids, outcome: step.value };
    ids.push(step.value.externalId);
  }
}

describe("paginate", () => {
  it("runs one unfiltered query to its end and reports a complete fetch", async () => {
    const { fetchPage, requests } = scriptedPages({ "": [["a", "b"], ["c"]] });

    const { ids, outcome } = await run(false, { maxPages: 5 }, fetchPage);

    expect(ids).toEqual(["a", "b", "c"]);
    expect(requests).toEqual([
      { keyword: null, pageIndex: 0, fetchedSoFar: 0 },
      { keyword: null, pageIndex: 1, fetchedSoFar: 2 },
    ]);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops at the page cap and reports an incomplete fetch", async () => {
    const { fetchPage } = scriptedPages({ "": [["a"], ["b"], ["c"]] });

    const { ids, outcome } = await run(false, { maxPages: 2 }, fetchPage);

    expect(ids).toEqual(["a", "b"]);
    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 2 });
  });

  it("is complete when the last page is the cap page and has no more", async () => {
    const { fetchPage } = scriptedPages({ "": [["a"], ["b"]] });

    const { outcome } = await run(false, { maxPages: 2 }, fetchPage);

    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("stops after a page of only known jobs when the recipe is sorted newest first", async () => {
    const { fetchPage, requests } = scriptedPages({ "": [["new"], ["old1", "old2"], ["older"]] });

    const { ids, outcome } = await run(
      true,
      { maxPages: 5, knownExternalIds: new Set(["old1", "old2", "older"]) },
      fetchPage,
    );

    expect(ids).toEqual(["new", "old1", "old2"]);
    expect(requests).toHaveLength(2);
    expect(outcome).toEqual({ complete: false, stopReason: "known-ids", pagesFetched: 2 });
  });

  it("keeps paging when only some jobs on the page are known (a reposted old job)", async () => {
    const { fetchPage } = scriptedPages({ "": [["old1", "new"], ["old2"]] });

    const { ids, outcome } = await run(
      true,
      { maxPages: 5, knownExternalIds: new Set(["old1", "old2"]) },
      fetchPage,
    );

    expect(ids).toEqual(["old1", "new", "old2"]);
    expect(outcome.stopReason).toBe("end");
  });

  it("never stops early when the recipe is not sorted newest first", async () => {
    const { fetchPage } = scriptedPages({ "": [["old1"], ["old2"]] });

    const { ids, outcome } = await run(
      false,
      { maxPages: 5, knownExternalIds: new Set(["old1", "old2"]) },
      fetchPage,
    );

    expect(ids).toEqual(["old1", "old2"]);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 2 });
  });

  it("never stops early without known IDs (full and verify modes)", async () => {
    const { fetchPage } = scriptedPages({ "": [["a"], ["b"]] });

    const { outcome } = await run(true, { maxPages: 5 }, fetchPage);

    expect(outcome.stopReason).toBe("end");
  });

  it("runs one query per keyword, de-duplicates across them and restarts the offsets", async () => {
    const { fetchPage, requests } = scriptedPages({
      dialogflow: [["a", "b"], ["c"]],
      "agent assist": [["b", "d"]],
    });

    const { ids, outcome } = await run(
      false,
      { maxPages: 5, keywords: ["dialogflow", "agent assist"] },
      fetchPage,
    );

    expect(ids).toEqual(["a", "b", "c", "d"]);
    expect(
      requests.map((request) => [request.keyword, request.pageIndex, request.fetchedSoFar]),
    ).toEqual([
      ["dialogflow", 0, 0],
      ["dialogflow", 1, 2],
      ["agent assist", 0, 0],
    ]);
    expect(outcome).toEqual({ complete: true, stopReason: "end", pagesFetched: 3 });
  });

  it("reports incomplete when any one keyword hits the page cap", async () => {
    const { fetchPage } = scriptedPages({ one: [["a"]], two: [["b"], ["c"]] });

    const { outcome } = await run(false, { maxPages: 1, keywords: ["one", "two"] }, fetchPage);

    expect(outcome).toEqual({ complete: false, stopReason: "page-cap", pagesFetched: 2 });
  });

  it("does not drop jobs without an externalId, so the refresh service can count them invalid", async () => {
    const { fetchPage } = scriptedPages({ "": [["", ""]] });

    const { ids } = await run(false, { maxPages: 1 }, fetchPage);

    expect(ids).toEqual(["", ""]);
  });

  it("stops when the company signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("budget"));
    const { fetchPage } = scriptedPages({ "": [["a"]] });

    await expect(run(false, { signal: controller.signal }, fetchPage)).rejects.toThrow("budget");
  });
});
