import { describe, expect, it } from "vitest";
import { RecipeWriteError, resolveRecipeWrite } from "../../src/recipes/write-rules";
import { type CompanyRecipe, CompanyRecipeSchema } from "../../src/types";
import { recipeInput } from "../helpers";

function recipe(overrides: Record<string, unknown> = {}): CompanyRecipe {
  return CompanyRecipeSchema.parse(recipeInput("acme", overrides));
}

describe("resolveRecipeWrite: new recipes", () => {
  it("accepts unverified, needs-manual and disabled, and drops any proof the client sent", () => {
    const sent = recipe({ status: "unverified", verifiedOn: "2026-01-01", lastError: "x" });

    const resolved = resolveRecipeWrite(undefined, sent);

    expect(resolved.status).toBe("unverified");
    expect(resolved.verifiedOn).toBeUndefined();
    expect(resolved.lastError).toBeUndefined();
  });

  it.each(["verified", "broken"])("rejects a new %s recipe", (status) => {
    expect(() => resolveRecipeWrite(undefined, recipe({ status }))).toThrow(RecipeWriteError);
  });
});

describe("resolveRecipeWrite: existing recipes", () => {
  const stored = recipe({ lastError: undefined });

  it("keeps the stored proof when only notes change, whatever proof the client sends", () => {
    const resolved = resolveRecipeWrite(
      stored,
      recipe({ notes: "edited", verifiedOn: "2030-01-01", lastError: "fake" }),
    );

    expect(resolved).toMatchObject({
      status: "verified",
      verifiedOn: "2026-11-01",
      notes: "edited",
    });
    expect(resolved.lastError).toBeUndefined();
  });

  it.each([
    ["fetch url", { fetch: { url: "https://boards-api.greenhouse.io/v1/boards/other/jobs" } }],
    ["keywords", { filters: { keywords: ["CCAI"], indiaFiltered: false } }],
    ["ats", { ats: "lever", fetch: { url: "https://api.lever.co/v0/postings/acme" } }],
  ])("resets to unverified and clears the proof when %s changes", (_name, change) => {
    const resolved = resolveRecipeWrite(stored, recipe(change));

    expect(resolved.status).toBe("unverified");
    expect(resolved.verifiedOn).toBeUndefined();
  });

  it("does not let a client mark an unproven recipe verified", () => {
    const unverified = recipe({ status: "unverified", verifiedOn: undefined });

    const resolved = resolveRecipeWrite(unverified, recipe({ status: "verified" }));

    expect(resolved.status).toBe("unverified");
    expect(resolved.verifiedOn).toBeUndefined();
  });

  it("keeps broken as broken (a client cannot upgrade it to verified)", () => {
    const broken = recipe({ status: "broken", lastError: "HTTP 500" });

    const resolved = resolveRecipeWrite(broken, recipe({ status: "verified" }));

    expect(resolved).toMatchObject({ status: "broken", lastError: "HTTP 500" });
  });

  it("disabling keeps the proof; asking for unverified (enabling) clears it", () => {
    const disabled = resolveRecipeWrite(stored, recipe({ status: "disabled" }));
    expect(disabled).toMatchObject({ status: "disabled", verifiedOn: "2026-11-01" });

    const enabled = resolveRecipeWrite(disabled, recipe({ status: "unverified" }));
    expect(enabled.status).toBe("unverified");
    expect(enabled.verifiedOn).toBeUndefined();
  });
});
