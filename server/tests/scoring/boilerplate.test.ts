import { describe, expect, it } from "vitest";
import { BOILERPLATE_MIN_JOBS, PROFILE_PATH } from "../../src/config";
import { loadProfile } from "../../src/profile/store";
import { findBoilerplateConcepts } from "../../src/scoring/boilerplate";
import { compileProfile } from "../../src/scoring/compile-profile";

const profile = compileProfile(loadProfile(PROFILE_PATH));

const terms = (descriptions: string[]) =>
  [...findBoilerplateConcepts(descriptions, profile)].map((concept) => concept.term);

const withShared = (shared: string, count: number, other = "Plain unrelated text.") =>
  Array.from({ length: BOILERPLATE_MIN_JOBS }, (_, index) => (index < count ? shared : other));

describe("findBoilerplateConcepts", () => {
  it("flags a concept that appears in at least half of the company's descriptions", () => {
    const descriptions = withShared("Our contact center platform and CCAI.", 5);

    expect(terms(descriptions).sort()).toEqual(["CCAI", "contact center"]);
  });

  it("leaves a concept alone when fewer than half of the descriptions have it", () => {
    expect(terms(withShared("Dialogflow CX experience.", 4))).toEqual([]);
  });

  it("counts a job once however often it repeats a concept", () => {
    const repeated = "CCAI CCAI CCAI CCAI CCAI.";

    expect(terms(withShared(repeated, 4))).toEqual([]);
  });

  it("does nothing for a small company, where a shared concept may be its real focus", () => {
    const descriptions = withShared("Our contact center platform.", BOILERPLATE_MIN_JOBS).slice(
      0,
      BOILERPLATE_MIN_JOBS - 1,
    );

    expect(terms(descriptions)).toEqual([]);
  });

  it("ignores jobs without a description when judging the share and the size", () => {
    const empty = Array.from({ length: 20 }, () => "");

    expect(terms([...empty, ...withShared("Our contact center platform.", 10)])).toEqual([
      "contact center",
    ]);
    expect(terms([...empty, "Our contact center platform."])).toEqual([]);
  });
});
