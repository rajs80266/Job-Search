import type { Profile } from "@server/types";

export function parseList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function replaceAt<T>(items: readonly T[], index: number, patch: Partial<T>): T[] {
  return items.map((item, position) => (position === index ? { ...item, ...patch } : item));
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, position) => position !== index);
}

/** Renaming a city keeps it in the preferred list (the schema requires preferred names to exist). */
export function renameCity(profile: Profile, index: number, name: string): Profile {
  const old = profile.cities[index]?.name;
  return {
    ...profile,
    cities: replaceAt(profile.cities, index, { name }),
    candidate: {
      ...profile.candidate,
      preferredCities: profile.candidate.preferredCities.map((city) =>
        city === old ? name : city,
      ),
    },
  };
}

export function removeCity(profile: Profile, index: number): Profile {
  const old = profile.cities[index]?.name;
  return {
    ...profile,
    cities: removeAt(profile.cities, index),
    candidate: {
      ...profile.candidate,
      preferredCities: profile.candidate.preferredCities.filter((city) => city !== old),
    },
  };
}

export function togglePreferredCity(profile: Profile, city: string): Profile {
  const { preferredCities } = profile.candidate;
  return {
    ...profile,
    candidate: {
      ...profile.candidate,
      preferredCities: preferredCities.includes(city)
        ? preferredCities.filter((name) => name !== city)
        : [...preferredCities, city],
    },
  };
}

export function sameProfile(left: Profile, right: Profile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
