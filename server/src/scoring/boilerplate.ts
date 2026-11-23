import { BOILERPLATE_MIN_JOBS, BOILERPLATE_MIN_SHARE } from "../config";
import { tokenize } from "../lib/phrases";
import type { CompiledProfile, Concept } from "./compile-profile";
import { matchedConcepts } from "./relevance";

/**
 * Concepts that appear in the descriptions of at least half of a company's jobs ("contact center"
 * in every posting's "About us") say nothing about one job, so scoring ignores them in descriptions.
 * Small boards are left alone: with few jobs a shared concept may be a real focus of the company.
 */
export function findBoilerplateConcepts(
  descriptions: readonly string[],
  profile: CompiledProfile,
): ReadonlySet<Concept> {
  const nonEmpty = descriptions.filter((description) => description !== "");
  if (nonEmpty.length < BOILERPLATE_MIN_JOBS) return new Set();

  const jobsPerConcept = new Map<Concept, number>();
  for (const description of nonEmpty) {
    for (const concept of new Set(matchedConcepts(profile, tokenize(description)))) {
      jobsPerConcept.set(concept, (jobsPerConcept.get(concept) ?? 0) + 1);
    }
  }

  const minJobs = nonEmpty.length * BOILERPLATE_MIN_SHARE;
  return new Set(
    [...jobsPerConcept].filter(([, jobCount]) => jobCount >= minJobs).map(([concept]) => concept),
  );
}
