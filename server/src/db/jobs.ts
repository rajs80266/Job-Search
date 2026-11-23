import type { NormalizedJob, RelevanceTier } from "../types";
import type { Db } from "./connection";

export interface RawJobRow {
  id: string;
  company_slug: string;
  external_id: string;
  title: string;
  url: string;
  location_raw: string;
  cities_json: string;
  is_india: number;
  is_remote: number;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  closed_at: string | null;
  description_snippet: string;
  relevance_score: number;
  relevance_tier: RelevanceTier;
  matched_keywords_json: string;
}

export function toNormalizedJob(row: RawJobRow): NormalizedJob {
  return {
    id: row.id,
    companySlug: row.company_slug,
    externalId: row.external_id,
    title: row.title,
    url: row.url,
    locationRaw: row.location_raw,
    cities: JSON.parse(row.cities_json) as string[],
    isIndia: row.is_india === 1,
    isRemote: row.is_remote === 1,
    postedAt: row.posted_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    closedAt: row.closed_at,
    descriptionSnippet: row.description_snippet,
    relevanceScore: row.relevance_score,
    relevanceTier: row.relevance_tier,
    matchedKeywords: JSON.parse(row.matched_keywords_json) as string[],
  };
}

export interface StoredJobSummary {
  externalId: string;
  descriptionSnippet: string;
  closedAt: string | null;
}

export function listStoredJobSummaries(db: Db, companySlug: string): StoredJobSummary[] {
  const rows = db
    .prepare("SELECT external_id, description_snippet, closed_at FROM jobs WHERE company_slug = ?")
    .all(companySlug) as {
    external_id: string;
    description_snippet: string;
    closed_at: string | null;
  }[];
  return rows.map((row) => ({
    externalId: row.external_id,
    descriptionSnippet: row.description_snippet,
    closedAt: row.closed_at,
  }));
}

export function listJobs(db: Db, companySlug: string): NormalizedJob[] {
  const rows = db
    .prepare("SELECT * FROM jobs WHERE company_slug = ? ORDER BY external_id")
    .all(companySlug) as RawJobRow[];
  return rows.map(toNormalizedJob);
}

export function getJob(db: Db, jobId: string): NormalizedJob | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as RawJobRow | undefined;
  return row && toNormalizedJob(row);
}

/**
 * Inserts the job or refreshes it. An existing job keeps its original first_seen_at, is
 * reopened (closed_at cleared), and keeps its old posted_at when the new one is unknown.
 */
export function upsertJob(db: Db, job: NormalizedJob): void {
  db.prepare(
    `INSERT INTO jobs (
       id, company_slug, external_id, title, url, location_raw, cities_json, is_india, is_remote,
       posted_at, first_seen_at, last_seen_at, closed_at, description_snippet,
       relevance_score, relevance_tier, matched_keywords_json
     ) VALUES (
       @id, @companySlug, @externalId, @title, @url, @locationRaw, @citiesJson, @isIndia, @isRemote,
       @postedAt, @firstSeenAt, @lastSeenAt, NULL, @descriptionSnippet,
       @relevanceScore, @relevanceTier, @matchedKeywordsJson
     )
     ON CONFLICT(company_slug, external_id) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       location_raw = excluded.location_raw,
       cities_json = excluded.cities_json,
       is_india = excluded.is_india,
       is_remote = excluded.is_remote,
       posted_at = COALESCE(excluded.posted_at, jobs.posted_at),
       last_seen_at = excluded.last_seen_at,
       closed_at = NULL,
       description_snippet = excluded.description_snippet,
       relevance_score = excluded.relevance_score,
       relevance_tier = excluded.relevance_tier,
       matched_keywords_json = excluded.matched_keywords_json`,
  ).run({
    id: job.id,
    companySlug: job.companySlug,
    externalId: job.externalId,
    title: job.title,
    url: job.url,
    locationRaw: job.locationRaw,
    citiesJson: JSON.stringify(job.cities),
    isIndia: job.isIndia ? 1 : 0,
    isRemote: job.isRemote ? 1 : 0,
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    lastSeenAt: job.lastSeenAt,
    descriptionSnippet: job.descriptionSnippet,
    relevanceScore: job.relevanceScore,
    relevanceTier: job.relevanceTier,
    matchedKeywordsJson: JSON.stringify(job.matchedKeywords),
  });
}

/**
 * Closes the company's open jobs that were not seen. With `notSeenSince`, only those whose
 * last_seen_at is older than it (for capped fetches that can never prove a job is gone).
 * Returns how many were closed.
 */
export function closeUnseenJobs(
  db: Db,
  companySlug: string,
  seenExternalIds: ReadonlySet<string>,
  closedAt: string,
  notSeenSince: string | null = null,
): number {
  const candidates = (
    db
      .prepare(
        `SELECT external_id FROM jobs
         WHERE company_slug = ? AND closed_at IS NULL AND (? IS NULL OR last_seen_at < ?)`,
      )
      .all(companySlug, notSeenSince, notSeenSince) as { external_id: string }[]
  ).map((row) => row.external_id);

  const close = db.prepare(
    "UPDATE jobs SET closed_at = ? WHERE company_slug = ? AND external_id = ?",
  );
  const unseen = candidates.filter((externalId) => !seenExternalIds.has(externalId));
  for (const externalId of unseen) close.run(closedAt, companySlug, externalId);
  return unseen.length;
}
