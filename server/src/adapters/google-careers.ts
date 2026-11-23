import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { getPath, toText } from "../lib/dot-path";
import { paginate } from "./paginate";
import { HTML_ACCEPT, requireFetchSpec, withQueryParams } from "./shared";

const DATA_BLOCK_MARKER = "key: 'ds:1'";
const JOB_PAGE_PATH = "/about/careers/applications/jobs/results";

const LAYOUT_ERROR =
  "Unexpected Google careers page layout (the embedded job data changed); the adapter needs an update";

/** Index of the `]` that closes the `[` at `start`, skipping brackets inside JSON strings. */
function findClosingBracket(text: string, start: number): number {
  let depth = 0;
  let insideString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (insideString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') insideString = false;
    } else if (char === '"') {
      insideString = true;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }
  throw new Error(LAYOUT_ERROR);
}

/** The page embeds its results as `AF_initDataCallback({key: 'ds:1', hash: '..', data: [...]})`. */
function extractResultsData(html: string): unknown[] {
  const markerIndex = html.indexOf(DATA_BLOCK_MARKER);
  const dataIndex = markerIndex === -1 ? -1 : html.indexOf("data:", markerIndex);
  const start = dataIndex === -1 ? -1 : html.indexOf("[", dataIndex);
  if (start === -1) throw new Error(LAYOUT_ERROR);

  let data: unknown;
  try {
    data = JSON.parse(html.slice(start, findClosingBracket(html, start) + 1));
  } catch {
    throw new Error(LAYOUT_ERROR);
  }
  if (!Array.isArray(data)) throw new Error(LAYOUT_ERROR);
  return data;
}

function htmlParts(job: unknown, paths: readonly string[]): string {
  return paths
    .map((path) => getPath(job, path))
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

/**
 * Positional job array: [0] id, [1] title, [3][1] responsibilities, [4][1] qualifications,
 * [9] locations, [10][1] description, [12] = [epoch seconds, nanos] when the job was created.
 */
function toFetchedJob(entry: unknown, origin: string): FetchedJob {
  const id = getPath(entry, "0");
  const title = getPath(entry, "1");
  const idIsUsable = typeof id === "string" || typeof id === "number";
  if (!Array.isArray(entry) || !idIsUsable || typeof title !== "string") {
    throw new Error(LAYOUT_ERROR);
  }

  const locations = getPath(entry, "9");
  const createdAt = getPath(entry, "12.0");
  return {
    externalId: String(id),
    title,
    url: `${origin}${JOB_PAGE_PATH}/${id}`,
    locationRaw: Array.isArray(locations)
      ? toText(locations.map((location) => getPath(location, "0")))
      : "",
    postedRaw: typeof createdAt === "number" ? createdAt : null,
    description: htmlParts(entry, ["10.1", "3.1", "4.1"]),
  };
}

/**
 * GET the public results page (`?location=India&sort_by=date&page=<n>&q=<keyword>`, 20 jobs per
 * page, newest first) and read the job data embedded in it. location comes from the recipe URL
 * unless filters.location is set.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const { origin } = new URL(fetchSpec.url);

  return yield* paginate(recipe, ctx, async ({ keyword, pageIndex, fetchedSoFar }) => {
    const response = await ctx.http.request({
      url: withQueryParams(fetchSpec.url, {
        q: keyword,
        location: recipe.filters.location,
        page: pageIndex + 1,
      }),
      headers: { ...HTML_ACCEPT, ...fetchSpec.headers },
      signal: ctx.signal,
    });

    const data = extractResultsData(response.text);
    const entries = data[0] ?? [];
    const total = data[2];
    if (!Array.isArray(entries) || typeof total !== "number") throw new Error(LAYOUT_ERROR);

    return {
      jobs: entries.map((entry) => toFetchedJob(entry, origin)),
      hasMore: entries.length > 0 && fetchedSoFar + entries.length < total,
    };
  });
}

export const googleCareersAdapter: Adapter = { ats: "google-careers", fetchJobs };
