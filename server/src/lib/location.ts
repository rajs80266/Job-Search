import { blankPhrases, containsAnyPhrase, findOwners, tokenize } from "./phrases";
import type { CompiledProfile } from "../scoring/compile-profile";
import { type ParsedLocation, REMOTE_CITY } from "../types";

/** One job can list several places ("Pune | London, United Kingdom"); each is judged on its own. */
const LOCATION_SEPARATOR = /[|;\n]/;

interface PartResult {
  cityIndexes: number[];
  isIndia: boolean;
  isRemote: boolean;
}

function parseLocationPart(
  part: string,
  indiaFiltered: boolean,
  profile: CompiledProfile,
): PartResult {
  const tokens = tokenize(part);
  const cityIndexes = [...findOwners(tokens, profile.cityPhrases)];
  const isRemote = containsAnyPhrase(tokens, profile.remoteTerms);
  const namesForeignCountry = containsAnyPhrase(tokens, profile.foreignCountryTerms);
  // "anywhere" inside "Work from anywhere" is a remote term, not a region that includes India.
  const tokensWithoutRemoteTerms = blankPhrases(tokens, profile.remoteTerms);

  const looksIndian =
    cityIndexes.length > 0 ||
    (isRemote && containsAnyPhrase(tokensWithoutRemoteTerms, profile.remoteRegionTerms));
  const isIndia =
    indiaFiltered ||
    containsAnyPhrase(tokens, profile.indiaTerms) ||
    (looksIndian && !namesForeignCountry);

  // A city shared with India ("Hyderabad, Pakistan") is not an Indian city when the country says otherwise.
  return { cityIndexes: isIndia ? cityIndexes : [], isIndia, isRemote };
}

/** Rules: docs/ARCHITECTURE.md §11.6. */
export function parseLocation(
  locationRaw: string,
  indiaFiltered: boolean,
  profile: CompiledProfile,
): ParsedLocation {
  const parts = locationRaw.split(LOCATION_SEPARATOR);
  const results = parts.map((part) => parseLocationPart(part, indiaFiltered, profile));

  const cityIndexes = [...new Set(results.flatMap((result) => result.cityIndexes))].sort(
    (a, b) => a - b,
  );
  const cities = cityIndexes.map((index) => profile.cities[index]?.name ?? "");
  const isRemote = results.some((result) => result.isRemote);
  if (isRemote) cities.push(REMOTE_CITY);

  return { cities, isIndia: results.some((result) => result.isIndia), isRemote };
}
