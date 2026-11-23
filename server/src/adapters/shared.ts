import type { CompanyRecipe, FetchSpec, FetchedJob } from "../types";

/** A listing entry we cannot read becomes an empty job, which the refresh service counts as invalid. */
export const UNREADABLE_JOB: FetchedJob = {
  externalId: "",
  title: "",
  url: "",
  locationRaw: "",
  postedRaw: null,
  description: "",
};

export const HTML_ACCEPT = { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" };

export function requireFetchSpec(recipe: CompanyRecipe): FetchSpec {
  if (!recipe.fetch) throw new Error(`${recipe.slug} has no fetch settings`);
  return recipe.fetch;
}

/** Copy of `rawUrl` with the given query parameters set; `null` values are left out. */
export function withQueryParams(
  rawUrl: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const url = new URL(rawUrl);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(name, String(value));
  }
  return url.toString();
}

/** "Delhi" + "India" -> "Delhi, India"; unchanged when the place already names the country. */
export function withCountry(place: string, country: string | null | undefined): string {
  const countryName = country?.trim() ?? "";
  if (countryName === "" || place.toLowerCase().includes(countryName.toLowerCase())) return place;
  return place === "" ? countryName : `${place}, ${countryName}`;
}

/** Joins non-empty address parts ("Bengaluru", "Karnataka", "India") into "Bengaluru, Karnataka, India". */
export function joinAddressParts(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(", ");
}

/** Several locations of one job, without blanks or repeats, as one " | " separated string. */
export function joinLocations(locations: readonly string[]): string {
  return [...new Set(locations.map((location) => location.trim()).filter(Boolean))].join(" | ");
}
