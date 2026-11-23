import { normalizeForMatching } from "../types";

/** A phrase as normalized tokens, e.g. "Kore.ai" -> ["kore", "ai"]. */
export type Phrase = readonly string[];

export interface OwnedPhrase {
  tokens: Phrase;
  /** Index of the concept (keyword, city, ...) that this phrase belongs to. */
  owner: number;
}

export function tokenize(text: string): string[] {
  const normalized = normalizeForMatching(text);
  return normalized === "" ? [] : normalized.split(" ");
}

export function sortLongestFirst(phrases: readonly OwnedPhrase[]): OwnedPhrase[] {
  return [...phrases].sort((a, b) => b.tokens.length - a.tokens.length);
}

/** Whole tokens only; the last token may carry one extra "s" (chatbot -> chatbots). */
function phraseStartsAt(tokens: readonly string[], start: number, phrase: Phrase): boolean {
  if (phrase.length === 0 || start + phrase.length > tokens.length) return false;
  const lastIndex = phrase.length - 1;
  return phrase.every((word, offset) => {
    const token = tokens[start + offset];
    return offset === lastIndex ? token === word || token === `${word}s` : token === word;
  });
}

function forEachMatch(
  tokens: readonly string[],
  phrase: Phrase,
  onMatch: (start: number) => void,
): void {
  for (let start = 0; start + phrase.length <= tokens.length; start++) {
    if (phraseStartsAt(tokens, start, phrase)) onMatch(start);
  }
}

/**
 * Finds which owners match. Phrases must be sorted longest first: a match consumes its tokens,
 * so a shorter phrase cannot reuse them ("Dialogflow CX" is not also "Dialogflow").
 */
export function findOwners(
  tokens: readonly string[],
  sortedPhrases: readonly OwnedPhrase[],
): Set<number> {
  const consumed = new Array<boolean>(tokens.length).fill(false);
  const owners = new Set<number>();

  for (const { tokens: phrase, owner } of sortedPhrases) {
    forEachMatch(tokens, phrase, (start) => {
      const range = consumed.slice(start, start + phrase.length);
      if (range.some(Boolean)) return;
      consumed.fill(true, start, start + phrase.length);
      owners.add(owner);
    });
  }
  return owners;
}

export function containsAnyPhrase(tokens: readonly string[], phrases: readonly Phrase[]): boolean {
  return phrases.some((phrase) => {
    let found = false;
    forEachMatch(tokens, phrase, () => {
      found = true;
    });
    return found;
  });
}

/** Replaces every token covered by one of the phrases with "", so nothing can match there. */
export function blankPhrases(tokens: readonly string[], phrases: readonly Phrase[]): string[] {
  const blanked = [...tokens];
  for (const phrase of phrases) {
    forEachMatch(tokens, phrase, (start) => {
      blanked.fill("", start, start + phrase.length);
    });
  }
  return blanked;
}
