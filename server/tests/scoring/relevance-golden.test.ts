import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseLocation } from "../../src/lib/location";
import { loadProfile } from "../../src/profile/store";
import { compileProfile } from "../../src/scoring/compile-profile";
import { scoreJob } from "../../src/scoring/relevance";
import type { RelevanceGoldenCase } from "../../src/types";
import { PROFILE_PATH } from "../../src/config";

const goldenPath = path.join(import.meta.dirname, "..", "fixtures", "relevance-golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as { cases: RelevanceGoldenCase[] };
const profile = compileProfile(loadProfile(PROFILE_PATH));

describe("relevance golden set", () => {
  it("has the 78 labeled cases", () => {
    expect(golden.cases).toHaveLength(78);
  });

  it.each(golden.cases)("$id: $title", (testCase) => {
    const result = scoreJob(testCase.title, testCase.description, profile);
    const location = parseLocation(testCase.location, testCase.indiaFiltered ?? false, profile);

    expect({ tier: result.relevanceTier, isIndia: location.isIndia }).toEqual(testCase.expected);
  });
});
