import { describe, expect, it } from "vitest";
import { PROFILE_PATH } from "../../src/config";
import { loadProfile } from "../../src/profile/store";
import { compileProfile } from "../../src/scoring/compile-profile";
import { matchedConcepts, scoreJob, titleMatchesCore } from "../../src/scoring/relevance";

const profile = compileProfile(loadProfile(PROFILE_PATH));

describe("scoreJob with ignored description concepts", () => {
  const ccai = matchedConcepts(profile, ["ccai"]);

  it("gives no description points for an ignored concept", () => {
    const description = "Experience with CCAI and virtual agents.";

    const normal = scoreJob("Senior Software Engineer", description, profile);
    const ignored = scoreJob("Senior Software Engineer", description, profile, new Set(ccai));

    expect(normal.matchedKeywords).toEqual(["CCAI", "virtual agent"]);
    expect(ignored.matchedKeywords).toEqual(["virtual agent"]);
    expect(ignored.relevanceScore).toBe(normal.relevanceScore - profile.weights.core.description);
  });

  it("still counts an ignored concept when the title names it", () => {
    const result = scoreJob("CCAI Engineer", "CCAI everywhere.", profile, new Set(ccai));

    expect(result.matchedKeywords).toEqual(["CCAI"]);
    expect(result.relevanceTier).toBe("high");
  });
});

describe("scoreJob", () => {
  it("adds core title points, the role bonus and capped-free description points", () => {
    const result = scoreJob(
      "Dialogflow CX Developer",
      "Own CCAI virtual agents for our customers.",
      profile,
    );

    expect(result).toEqual({
      relevanceScore: 24,
      relevanceTier: "high",
      matchedKeywords: ["Dialogflow CX", "CCAI", "virtual agent"],
    });
  });

  it("caps the description contribution so it alone never reaches high", () => {
    const result = scoreJob(
      "Senior Software Engineer",
      "Dialogflow CX, Agent Assist, virtual agents, CCAI, chatbot and IVR experience.",
      profile,
    );

    expect(result.relevanceScore).toBe(profile.weights.descriptionCap);
    expect(result.relevanceTier).toBe("medium");
  });

  it("does not give the role bonus to adjacent-only titles", () => {
    const result = scoreJob("Genesys Engineer", "IVR and contact center routing.", profile);

    expect(result.relevanceScore).toBe(12);
    expect(result.relevanceTier).toBe("medium");
  });

  it("counts a concept once even when it matches in title and description", () => {
    const result = scoreJob(
      "Chatbot Developer",
      "Build a chatbot. Maintain the chat bot.",
      profile,
    );

    expect(result.relevanceScore).toBe(16);
    expect(result.matchedKeywords).toEqual(["chatbot"]);
  });

  it("lets the longest phrase win so overlapping concepts are not double counted", () => {
    const result = scoreJob("Dialogflow CX Engineer", "", profile);

    expect(result.matchedKeywords).toEqual(["Dialogflow CX"]);
    expect(result.relevanceScore).toBe(16);
  });

  it("matches whole tokens, with an optional plural s on the last token", () => {
    expect(scoreJob("Salesforce Developer", "", profile).relevanceScore).toBe(0);
    expect(scoreJob("Chatbots Engineer", "", profile).matchedKeywords).toEqual(["chatbot"]);
  });

  it("lists title matches before description matches", () => {
    const result = scoreJob("IVR Engineer", "Dialogflow and Genesys.", profile);

    expect(result.matchedKeywords).toEqual(["IVR", "Dialogflow", "Genesys"]);
  });

  it("subtracts penalties but never goes below zero", () => {
    expect(scoreJob("Junior Chatbot Developer", "Dialogflow", profile).relevanceScore).toBe(2);
    expect(
      scoreJob("Customer Support Executive - Voice", "voice process", profile).relevanceScore,
    ).toBe(0);
  });

  it("does not penalize pre-sales roles but penalizes sales roles", () => {
    const preSales = scoreJob("Pre-Sales Solution Consultant - Conversational AI", "", profile);
    const sales = scoreJob("Inside Sales Executive - Conversational AI", "", profile);

    expect(preSales.relevanceTier).toBe("high");
    expect(sales.relevanceScore).toBeLessThan(preSales.relevanceScore);
  });

  it("applies title-scoped negatives to the title only", () => {
    const result = scoreJob("Automation Engineer - IVR", "automate telecalling workflows", profile);

    expect(result.relevanceTier).toBe("high");
  });

  it("returns none with an empty score for unrelated jobs", () => {
    expect(scoreJob("Accountant", "Books and ledgers", profile)).toEqual({
      relevanceScore: 0,
      relevanceTier: "none",
      matchedKeywords: [],
    });
  });
});

describe("titleMatchesCore", () => {
  it("is true for core concepts and aliases", () => {
    expect(titleMatchesCore("Contact Center AI Engineer", profile)).toBe(true);
    expect(titleMatchesCore("Dialog flow CX Developer", profile)).toBe(true);
  });

  it("is false for adjacent-only and unrelated titles", () => {
    expect(titleMatchesCore("Genesys Engineer", profile)).toBe(false);
    expect(titleMatchesCore("Accountant", profile)).toBe(false);
  });
});
