import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adapterRegistry } from "../../src/adapters";
import { loadRecipe } from "../../src/recipes/store";
import {
  NotVerifiableError,
  verificationPatch,
  verifyAndSaveRecipe,
  verifyRecipe,
} from "../../src/refresh/verify";
import { CompanyRecipeSchema } from "../../src/types";
import {
  fakeHttp,
  jsonResponse,
  makeJob,
  makeTempDir,
  recipeInput,
  scriptedAdapter,
  writeRecipeFile,
} from "../helpers";
import { HttpError } from "../../src/lib/http";

const greenhouseFixture: unknown = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "fixtures", "greenhouse.json"), "utf8"),
);
const parse = (overrides: Record<string, unknown> = {}) =>
  CompanyRecipeSchema.parse(recipeInput("acme", overrides));
const now = () => new Date(2026, 10, 21, 12, 0, 0);

describe("verifyRecipe", () => {
  it("runs the greenhouse adapter live-style and reports count and three sample titles", async () => {
    const { client, requests } = fakeHttp(() => jsonResponse(greenhouseFixture));

    const result = await verifyRecipe(parse(), { http: client, adapters: adapterRegistry });

    expect(result).toMatchObject({ ok: true, jobCount: 4, error: null, saved: false });
    expect(result.sampleTitles).toHaveLength(3);
    expect(requests).toHaveLength(1);
  });

  it("fails when the endpoint returns no jobs", async () => {
    const { client } = fakeHttp(() => jsonResponse({ jobs: [] }));

    const result = await verifyRecipe(parse(), { http: client, adapters: adapterRegistry });

    expect(result).toMatchObject({
      ok: false,
      jobCount: 0,
      error: "the endpoint returned no jobs",
    });
  });

  it("fails when no job has an id, title and absolute url", async () => {
    const adapters = {
      greenhouse: scriptedAdapter(() => ({ jobs: [makeJob("1", { url: "/relative" })] })),
    };

    const result = await verifyRecipe(parse(), {
      http: fakeHttp(() => jsonResponse({})).client,
      adapters,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("invalid");
  });

  it("reports an HTTP failure as the error", async () => {
    const { client } = fakeHttp(() => {
      throw new HttpError("HTTP 404 for https://boards-api.greenhouse.io/x", 404, "https://x");
    });

    const result = await verifyRecipe(parse(), { http: client, adapters: adapterRegistry });

    expect(result).toMatchObject({
      ok: false,
      error: "HTTP 404 for https://boards-api.greenhouse.io/x",
    });
  });

  it("fails clearly for an ATS without an adapter", async () => {
    const recipe = parse({ ats: "lever", fetch: { url: "https://api.lever.co/v0/postings/acme" } });

    const result = await verifyRecipe(recipe, {
      http: fakeHttp(() => jsonResponse({})).client,
      adapters: {},
    });

    expect(result).toMatchObject({ ok: false, error: "no adapter for lever" });
  });

  it("treats a failing sample description request as a warning, not a failure", async () => {
    const adapters = {
      greenhouse: scriptedAdapter(() => ({ jobs: [makeJob("1")] }), {
        fetchDescription: () => Promise.reject(new Error("HTTP 500")),
      }),
    };

    const result = await verifyRecipe(parse(), {
      http: fakeHttp(() => jsonResponse({})).client,
      adapters,
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(["sample description request failed: HTTP 500"]);
  });

  it("verifies with no keywords and a single page, whatever the recipe says", async () => {
    let seen: { keywords: readonly string[]; maxPages: number } | undefined;
    const adapters = {
      greenhouse: scriptedAdapter((_recipe, ctx) => {
        seen = { keywords: ctx.keywords, maxPages: ctx.maxPages };
        return { jobs: [makeJob("1")] };
      }),
    };
    const recipe = parse({ filters: { keywords: ["Dialogflow"] } });

    await verifyRecipe(recipe, { http: fakeHttp(() => jsonResponse({})).client, adapters });

    expect(seen).toEqual({ keywords: [], maxPages: 1 });
  });
});

describe("verificationPatch", () => {
  it("marks success as verified today and clears lastError", () => {
    expect(
      verificationPatch(
        parse({ status: "broken", lastError: "old" }),
        { ok: true, error: null },
        "2026-11-21",
      ),
    ).toEqual({
      status: "verified",
      verifiedOn: "2026-11-21",
      lastError: undefined,
    });
  });

  it("turns a failing verified recipe into broken and keeps verifiedOn", () => {
    expect(verificationPatch(parse(), { ok: false, error: "HTTP 500" }, "2026-11-21")).toEqual({
      status: "broken",
      verifiedOn: "2026-11-01",
      lastError: "HTTP 500",
    });
  });

  it("keeps a failing unverified recipe unverified", () => {
    const recipe = parse({ status: "unverified", verifiedOn: undefined });

    expect(verificationPatch(recipe, { ok: false, error: "no jobs" }, "2026-11-21")).toEqual({
      status: "unverified",
      verifiedOn: undefined,
      lastError: "no jobs",
    });
  });

  it("truncates a long error to fit the recipe schema", () => {
    const patch = verificationPatch(parse(), { ok: false, error: "x".repeat(900) }, "2026-11-21");

    expect(patch.lastError).toHaveLength(500);
  });
});

describe("verifyAndSaveRecipe", () => {
  it("sets status verified and verifiedOn to today on success", async () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme", { status: "unverified", verifiedOn: undefined });
    const { client } = fakeHttp(() => jsonResponse(greenhouseFixture));

    const result = await verifyAndSaveRecipe(dir, "acme", {
      http: client,
      adapters: adapterRegistry,
      now,
    });

    expect(result).toMatchObject({ ok: true, saved: true });
    expect(loadRecipe(dir, "acme")).toMatchObject({ status: "verified", verifiedOn: "2026-11-21" });
    expect(loadRecipe(dir, "acme").lastError).toBeUndefined();
  });

  it("writes lastError and leaves an unverified recipe unverified on failure", async () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme", { status: "unverified", verifiedOn: undefined });
    const { client } = fakeHttp(() => jsonResponse({ jobs: [] }));

    const result = await verifyAndSaveRecipe(dir, "acme", {
      http: client,
      adapters: adapterRegistry,
      now,
    });

    expect(result).toMatchObject({ ok: false, saved: true });
    expect(loadRecipe(dir, "acme")).toMatchObject({
      status: "unverified",
      lastError: "the endpoint returned no jobs",
    });
    expect(loadRecipe(dir, "acme").verifiedOn).toBeUndefined();
  });

  it("marks a previously verified recipe broken but keeps its verifiedOn", async () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme");
    const { client } = fakeHttp(() => {
      throw new Error("HTTP 503");
    });

    await verifyAndSaveRecipe(dir, "acme", { http: client, adapters: adapterRegistry, now });

    expect(loadRecipe(dir, "acme")).toMatchObject({
      status: "broken",
      verifiedOn: "2026-11-01",
      lastError: "HTTP 503",
    });
  });

  it("refuses needs-manual and disabled recipes", async () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "off", { status: "disabled" });

    await expect(
      verifyAndSaveRecipe(dir, "off", {
        http: fakeHttp(() => jsonResponse({})).client,
        adapters: adapterRegistry,
      }),
    ).rejects.toBeInstanceOf(NotVerifiableError);
  });
});
