import type { Db } from "../db/connection";
import { parseLocation } from "../lib/location";
import { findBoilerplateConcepts } from "../scoring/boilerplate";
import { compileProfile } from "../scoring/compile-profile";
import { scoreJob } from "../scoring/relevance";
import { type Profile, RELEVANCE_TIERS, type RelevanceTier, type TierCounts } from "../types";

interface StoredJobForScoring {
  id: string;
  title: string;
  location_raw: string;
  description_snippet: string;
  closed_at: string | null;
  is_india: number;
  relevance_tier: RelevanceTier;
}

interface Rescored {
  id: string;
  citiesJson: string;
  isIndia: number;
  isRemote: number;
  relevanceScore: number;
  relevanceTier: RelevanceTier;
  matchedKeywordsJson: string;
}

export interface RescoreResult {
  rescored: number;
  /** Tier counts of open India jobs with the stored values, and with the new profile. */
  before: TierCounts;
  after: TierCounts;
}

const emptyCounts = (): TierCounts => ({ high: 0, medium: 0, low: 0, none: 0 });

/**
 * Re-runs location parsing and scoring on every stored job from its stored text (no fetch), as
 * a refresh would: the company's `indiaFiltered` flag applies and company boilerplate (concepts
 * in half of its open jobs' descriptions) earns nothing. With `write: false` nothing is changed:
 * this is the dry run behind the Profile page's live preview.
 */
export function rescoreStoredJobs(
  db: Db,
  profile: Profile,
  indiaFilteredBySlug: ReadonlyMap<string, boolean>,
  options: { write: boolean },
): RescoreResult {
  const compiled = compileProfile(profile);
  const before = emptyCounts();
  const after = emptyCounts();
  let rescored = 0;

  const slugs = (
    db.prepare("SELECT DISTINCT company_slug AS slug FROM jobs ORDER BY company_slug").all() as {
      slug: string;
    }[]
  ).map((row) => row.slug);
  const selectJobs = db.prepare(
    `SELECT id, title, location_raw, description_snippet, closed_at, is_india, relevance_tier
     FROM jobs WHERE company_slug = ?`,
  );
  const update = db.prepare(
    `UPDATE jobs SET cities_json = @citiesJson, is_india = @isIndia, is_remote = @isRemote,
       relevance_score = @relevanceScore, relevance_tier = @relevanceTier,
       matched_keywords_json = @matchedKeywordsJson
     WHERE id = @id`,
  );

  const run = (): void => {
    for (const slug of slugs) {
      const jobs = selectJobs.all(slug) as StoredJobForScoring[];
      const indiaFiltered = indiaFilteredBySlug.get(slug) ?? false;
      const openDescriptions = jobs
        .filter((job) => job.closed_at === null)
        .map((job) => job.description_snippet);
      const boilerplate = findBoilerplateConcepts(openDescriptions, compiled);

      for (const job of jobs) {
        const location = parseLocation(job.location_raw, indiaFiltered, compiled);
        const score = scoreJob(job.title, job.description_snippet, compiled, boilerplate);
        const isOpen = job.closed_at === null;
        if (isOpen && job.is_india === 1) before[job.relevance_tier]++;
        if (isOpen && location.isIndia) after[score.relevanceTier]++;
        rescored++;

        if (options.write) {
          const changed: Rescored = {
            id: job.id,
            citiesJson: JSON.stringify(location.cities),
            isIndia: location.isIndia ? 1 : 0,
            isRemote: location.isRemote ? 1 : 0,
            relevanceScore: score.relevanceScore,
            relevanceTier: score.relevanceTier,
            matchedKeywordsJson: JSON.stringify(score.matchedKeywords),
          };
          update.run(changed);
        }
      }
    }
  };
  run();

  // Keep the key order stable for callers that iterate it.
  const ordered = (counts: TierCounts): TierCounts =>
    Object.fromEntries(RELEVANCE_TIERS.map((tier) => [tier, counts[tier]])) as TierCounts;
  return { rescored, before: ordered(before), after: ordered(after) };
}
