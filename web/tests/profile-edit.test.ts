import type { Profile } from "@server/types";
import { describe, expect, it } from "vitest";
import {
  parseList,
  removeAt,
  removeCity,
  renameCity,
  replaceAt,
  sameList,
  sameProfile,
  togglePreferredCity,
} from "../src/lib/profile-edit";

const profile = {
  candidate: {
    experienceYears: { min: 5, max: 8 },
    targetLevels: [],
    preferredCities: ["Pune", "Remote"],
    openToRelocation: true,
  },
  cities: [
    { name: "Pune", aliases: ["Poona"] },
    { name: "Mumbai", aliases: [] },
  ],
} as unknown as Profile;

describe("lists", () => {
  it("parses comma-separated text", () => {
    expect(parseList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseList("")).toEqual([]);
  });

  it("compares lists in order", () => {
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameList([], ["a"])).toBe(false);
  });

  it("replaces and removes one item without touching the others", () => {
    const items = [{ n: 1 }, { n: 2 }, { n: 3 }];
    expect(replaceAt(items, 1, { n: 20 })).toEqual([{ n: 1 }, { n: 20 }, { n: 3 }]);
    expect(removeAt(items, 0)).toEqual([{ n: 2 }, { n: 3 }]);
    expect(items).toHaveLength(3);
  });
});

describe("cities", () => {
  it("keeps a renamed city preferred", () => {
    const renamed = renameCity(profile, 0, "Pune City");

    expect(renamed.cities.map((city) => city.name)).toEqual(["Pune City", "Mumbai"]);
    expect(renamed.candidate.preferredCities).toEqual(["Pune City", "Remote"]);
  });

  it("drops a removed city from the preferred list", () => {
    const removed = removeCity(profile, 0);

    expect(removed.cities.map((city) => city.name)).toEqual(["Mumbai"]);
    expect(removed.candidate.preferredCities).toEqual(["Remote"]);
  });

  it("toggles a preferred city", () => {
    const added = togglePreferredCity(profile, "Mumbai");
    expect(added.candidate.preferredCities).toEqual(["Pune", "Remote", "Mumbai"]);
    expect(togglePreferredCity(added, "Pune").candidate.preferredCities).toEqual([
      "Remote",
      "Mumbai",
    ]);
  });
});

describe("sameProfile", () => {
  it("is true for equal content and false after an edit", () => {
    expect(sameProfile(profile, structuredClone(profile))).toBe(true);
    expect(sameProfile(profile, renameCity(profile, 1, "Navi Mumbai"))).toBe(false);
  });
});
