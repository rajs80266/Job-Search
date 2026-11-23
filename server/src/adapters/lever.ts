import { z } from "zod";
import type { Adapter, CompanyRecipe, FetchContext, FetchedJob, FetchOutcome } from "../types";
import { paginate } from "./paginate";
import {
  UNREADABLE_JOB,
  joinLocations,
  requireFetchSpec,
  withCountry,
  withQueryParams,
} from "./shared";

const DEFAULT_PAGE_SIZE = 100;
/** Lever gives only a two-letter country code; the location text often omits the country. */
const INDIA_COUNTRY_CODE = "IN";

const PostingSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.string(),
  /** Epoch milliseconds. */
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  lists: z.array(z.object({ text: z.string(), content: z.string() })).nullish(),
});

const ListResponseSchema = z.array(z.unknown());

function locationOf(posting: z.infer<typeof PostingSchema>): string {
  const { categories } = posting;
  const places = categories?.allLocations?.length
    ? categories.allLocations
    : [categories?.location ?? ""];
  const countryName = posting.country === INDIA_COUNTRY_CODE ? "India" : null;
  const remoteMarker = posting.workplaceType === "remote" ? ["Remote"] : [];
  return joinLocations([
    ...places.map((place) => withCountry(place, countryName)),
    ...remoteMarker,
  ]);
}

function descriptionOf(posting: z.infer<typeof PostingSchema>): string {
  const listSections = (posting.lists ?? []).map(
    (list) => `<h3>${list.text}</h3><ul>${list.content}</ul>`,
  );
  return [posting.description ?? "", ...listSections].join("\n");
}

function toFetchedJob(entry: unknown): FetchedJob {
  const parsed = PostingSchema.safeParse(entry);
  if (!parsed.success) return UNREADABLE_JOB;

  const posting = parsed.data;
  return {
    externalId: posting.id,
    title: posting.text,
    url: posting.hostedUrl,
    locationRaw: locationOf(posting),
    postedRaw: posting.createdAt ?? null,
    description: descriptionOf(posting),
  };
}

/**
 * GET `api.lever.co/v0/postings/<site>?mode=json`. Lever has no keyword search, so
 * ctx.keywords is ignored. `filters.location` is sent as `location=`, which Lever matches
 * exactly against a posting's location name (not a country). Pages with skip/limit.
 */
async function* fetchJobs(
  recipe: CompanyRecipe,
  ctx: FetchContext,
): AsyncGenerator<FetchedJob, FetchOutcome, undefined> {
  const fetchSpec = requireFetchSpec(recipe);
  const pageSize = fetchSpec.pagination.pageSize ?? DEFAULT_PAGE_SIZE;

  return yield* paginate(recipe, { ...ctx, keywords: [] }, async ({ fetchedSoFar }) => {
    const response = await ctx.http.request({
      url: withQueryParams(fetchSpec.url, {
        location: recipe.filters.location,
        skip: fetchedSoFar,
        limit: pageSize,
      }),
      headers: fetchSpec.headers,
      signal: ctx.signal,
    });

    const postings = ListResponseSchema.safeParse(response.json());
    if (!postings.success) throw new Error("Unexpected Lever response: not a postings array");

    return {
      jobs: postings.data.map(toFetchedJob),
      hasMore: postings.data.length >= pageSize,
    };
  });
}

export const leverAdapter: Adapter = { ats: "lever", fetchJobs };
