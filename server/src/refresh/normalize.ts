import { parsePostedAt } from "../lib/dates";
import { makeJobId } from "../lib/job-id";
import { parseLocation } from "../lib/location";
import { collapseWhitespace, toSnippet } from "../lib/text";
import type { CompiledProfile, Concept } from "../scoring/compile-profile";
import { scoreJob } from "../scoring/relevance";
import type { FetchedJob, NormalizedJob } from "../types";

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isValidFetchedJob(job: FetchedJob): boolean {
  return (
    job.externalId.trim() !== "" &&
    collapseWhitespace(job.title) !== "" &&
    isAbsoluteHttpUrl(job.url)
  );
}

export interface ValidatedJobs {
  /** Valid jobs, one per externalId (first occurrence wins). */
  jobs: FetchedJob[];
  /** Jobs dropped for a missing externalId/title or a non-absolute URL. */
  invalid: number;
}

export function validateAndDedupe(fetched: readonly FetchedJob[]): ValidatedJobs {
  const byExternalId = new Map<string, FetchedJob>();
  let invalid = 0;

  for (const job of fetched) {
    if (!isValidFetchedJob(job)) {
      invalid++;
      continue;
    }
    const externalId = job.externalId.trim();
    if (!byExternalId.has(externalId)) byExternalId.set(externalId, { ...job, externalId });
  }
  return { jobs: [...byExternalId.values()], invalid };
}

export interface NormalizeInput {
  job: FetchedJob;
  companySlug: string;
  indiaFiltered: boolean;
  /** HTML or text to build the snippet and score from; may differ from job.description. */
  description: string;
  fetchedAt: Date;
  profile: CompiledProfile;
  /** Company-wide wording that earns nothing from the description (scoring/boilerplate.ts). */
  boilerplateConcepts?: ReadonlySet<Concept>;
}

export function normalizeJob(input: NormalizeInput): NormalizedJob {
  const { job, companySlug, fetchedAt, profile } = input;
  const title = collapseWhitespace(job.title);
  const descriptionSnippet = toSnippet(input.description);
  const location = parseLocation(job.locationRaw, input.indiaFiltered, profile);
  const relevance = scoreJob(title, descriptionSnippet, profile, input.boilerplateConcepts);
  const fetchedAtIso = fetchedAt.toISOString();

  return {
    id: makeJobId(companySlug, job.externalId),
    companySlug,
    externalId: job.externalId,
    title,
    url: job.url,
    locationRaw: job.locationRaw,
    cities: location.cities,
    isIndia: location.isIndia,
    isRemote: location.isRemote,
    postedAt: parsePostedAt(job.postedRaw, fetchedAt),
    firstSeenAt: fetchedAtIso,
    lastSeenAt: fetchedAtIso,
    closedAt: null,
    descriptionSnippet,
    relevanceScore: relevance.relevanceScore,
    relevanceTier: relevance.relevanceTier,
    matchedKeywords: relevance.matchedKeywords,
  };
}
