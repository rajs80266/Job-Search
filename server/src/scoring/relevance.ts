import { blankPhrases, containsAnyPhrase, findOwners, tokenize } from "../lib/phrases";
import type { RelevanceResult, RelevanceTier } from "../types";
import type { CompiledProfile, Concept } from "./compile-profile";

/** Concepts found in the tokens, in profile order (core first, then adjacent). */
export function matchedConcepts(profile: CompiledProfile, tokens: readonly string[]): Concept[] {
  return [...findOwners(tokens, profile.conceptPhrases)]
    .sort((a, b) => a - b)
    .flatMap((index) => profile.concepts[index] ?? []);
}

function negativePenalty(
  profile: CompiledProfile,
  titleTokens: readonly string[],
  descriptionTokens: readonly string[],
): number {
  let penalty = 0;
  for (const negative of profile.negatives) {
    const fieldsToCheck =
      negative.scope === "title" ? [titleTokens] : [titleTokens, descriptionTokens];
    const matches = fieldsToCheck.some((tokens) =>
      containsAnyPhrase(blankPhrases(tokens, negative.exceptions), negative.phrases),
    );
    if (matches) penalty += negative.penalty;
  }
  return penalty;
}

function tierFor(score: number, profile: CompiledProfile): RelevanceTier {
  const { high, medium, low } = profile.tiers;
  if (score >= high) return "high";
  if (score >= medium) return "medium";
  if (score >= low) return "low";
  return "none";
}

/**
 * Formula and rationale: docs/ARCHITECTURE.md §11.3.
 * `ignoredDescriptionConcepts` are company boilerplate (see scoring/boilerplate.ts): they earn
 * nothing from the description, but still count when the title names them.
 */
export function scoreJob(
  title: string,
  description: string,
  profile: CompiledProfile,
  ignoredDescriptionConcepts: ReadonlySet<Concept> = new Set(),
): RelevanceResult {
  const { weights } = profile;
  const titleTokens = tokenize(title);
  const descriptionTokens = tokenize(description);

  const titleConcepts = matchedConcepts(profile, titleTokens);
  const alreadyInTitle = new Set(titleConcepts);
  const descriptionConcepts = matchedConcepts(profile, descriptionTokens).filter(
    (concept) => !alreadyInTitle.has(concept) && !ignoredDescriptionConcepts.has(concept),
  );

  const titlePoints = titleConcepts.reduce((total, { kind }) => total + weights[kind].title, 0);
  const hasCoreInTitle = titleConcepts.some(({ kind }) => kind === "core");
  const roleBonus =
    hasCoreInTitle && containsAnyPhrase(titleTokens, profile.roleTerms) ? weights.roleBonus : 0;
  const descriptionPoints = Math.min(
    descriptionConcepts.reduce((total, { kind }) => total + weights[kind].description, 0),
    weights.descriptionCap,
  );
  const penalty = negativePenalty(profile, titleTokens, descriptionTokens);

  const relevanceScore = Math.max(0, titlePoints + roleBonus + descriptionPoints - penalty);
  return {
    relevanceScore,
    relevanceTier: tierFor(relevanceScore, profile),
    matchedKeywords: [...titleConcepts, ...descriptionConcepts].map(({ term }) => term),
  };
}

/** True when the title names a core concept. Decides which jobs are worth a description request. */
export function titleMatchesCore(title: string, profile: CompiledProfile): boolean {
  return matchedConcepts(profile, tokenize(title)).some(({ kind }) => kind === "core");
}
