import type { Profile } from "../types";
import { type OwnedPhrase, type Phrase, sortLongestFirst, tokenize } from "../lib/phrases";

export type KeywordKind = "core" | "adjacent";

export interface Concept {
  kind: KeywordKind;
  /** What matchedKeywords shows. */
  term: string;
}

export interface CompiledNegative {
  penalty: number;
  scope: "title" | "titleAndDescription";
  phrases: Phrase[];
  exceptions: Phrase[];
}

export interface CompiledCity {
  name: string;
  phrases: OwnedPhrase[];
}

/** The profile with every phrase tokenized once, so scoring and location parsing stay cheap. */
export interface CompiledProfile {
  weights: Profile["weights"];
  tiers: Profile["tiers"];
  /** Core concepts first, then adjacent, each in profile order. Indexes are the owners below. */
  concepts: Concept[];
  /** All core and adjacent phrases, longest first. */
  conceptPhrases: OwnedPhrase[];
  roleTerms: Phrase[];
  negatives: CompiledNegative[];
  /** One entry per profile city, in profile order; phrases are owned by the city index. */
  cities: CompiledCity[];
  cityPhrases: OwnedPhrase[];
  indiaTerms: Phrase[];
  remoteTerms: Phrase[];
  remoteRegionTerms: Phrase[];
  foreignCountryTerms: Phrase[];
}

function tokenizeAll(texts: readonly string[]): Phrase[] {
  return texts.map((text) => tokenize(text));
}

export function compileProfile(profile: Profile): CompiledProfile {
  const concepts: Concept[] = [];
  const conceptPhrases: OwnedPhrase[] = [];

  for (const kind of ["core", "adjacent"] as const) {
    for (const keyword of profile.keywords[kind]) {
      const owner = concepts.length;
      concepts.push({ kind, term: keyword.term });
      for (const text of [keyword.term, ...keyword.aliases]) {
        conceptPhrases.push({ tokens: tokenize(text), owner });
      }
    }
  }

  const cities = profile.cities.map((city, owner) => ({
    name: city.name,
    phrases: [city.name, ...city.aliases].map((text) => ({ tokens: tokenize(text), owner })),
  }));

  return {
    weights: profile.weights,
    tiers: profile.tiers,
    concepts,
    conceptPhrases: sortLongestFirst(conceptPhrases),
    roleTerms: tokenizeAll(profile.roleTerms),
    negatives: profile.negativeTerms.map((negative) => ({
      penalty: negative.penalty,
      scope: negative.scope,
      phrases: tokenizeAll([negative.term, ...negative.aliases]),
      exceptions: tokenizeAll(negative.except),
    })),
    cities,
    cityPhrases: sortLongestFirst(cities.flatMap((city) => city.phrases)),
    indiaTerms: tokenizeAll(profile.indiaTerms),
    remoteTerms: tokenizeAll(profile.remoteTerms),
    remoteRegionTerms: tokenizeAll(profile.remoteRegionTerms),
    foreignCountryTerms: tokenizeAll(profile.foreignCountryTerms),
  };
}
