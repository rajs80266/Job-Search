import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCompany, upsertCompany } from "../../src/db/companies";
import { openDatabase } from "../../src/db/connection";
import {
  deleteRecipeFile,
  loadRecipe,
  loadRecipes,
  recipeExists,
  syncCompanies,
  writeVerification,
} from "../../src/recipes/store";
import { makeTempDir, recipeInput, writeRecipeFile } from "../helpers";

describe("loadRecipes", () => {
  it("treats a missing folder as no companies", () => {
    expect(loadRecipes(path.join(makeTempDir(), "does-not-exist"))).toEqual({
      recipes: [],
      invalidFiles: [],
    });
  });

  it("loads valid recipes with schema defaults and reports invalid files with the reason", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "good");
    writeRecipeFile(dir, "bad-category", { category: "nope" });
    writeRecipeFile(dir, "wrong-name", { slug: "someone-else" });
    writeFileSync(path.join(dir, "not-json.json"), "{ nope");
    writeFileSync(path.join(dir, "readme.txt"), "ignored");
    writeRecipeFile(dir, "verified-without-date", { verifiedOn: undefined });

    const { recipes, invalidFiles } = loadRecipes(dir);

    expect(recipes.map((recipe) => recipe.slug)).toEqual(["good"]);
    expect(recipes[0]?.filters).toEqual({ keywords: [], indiaFiltered: false });
    expect(Object.fromEntries(invalidFiles.map((file) => [file.file, file.error]))).toMatchObject({
      "bad-category.json": expect.stringContaining("category") as unknown,
      "wrong-name.json": expect.stringContaining("file name must be someone-else.json") as unknown,
      "verified-without-date.json": expect.stringContaining("verifiedOn") as unknown,
    });
    expect(invalidFiles.map((file) => file.file)).toContain("not-json.json");
  });

  it("rejects credential headers in a recipe", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "leaky", {
      fetch: {
        url: "https://boards-api.greenhouse.io/v1/boards/leaky/jobs",
        headers: { Cookie: "a=b" },
      },
    });

    expect(loadRecipes(dir).invalidFiles[0]?.error).toContain("credential");
  });
});

describe("loadRecipe", () => {
  it("throws a clear error for a missing or invalid file", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "bad", { ats: "nope" });

    expect(() => loadRecipe(dir, "missing")).toThrow(/No recipe file for "missing"/);
    expect(() => loadRecipe(dir, "bad")).toThrow(/Invalid recipe bad\.json/);
  });
});

describe("the committed company recipes", () => {
  it("all pass the schema and match their file names", () => {
    const dir = path.join(import.meta.dirname, "..", "..", "data", "companies");

    const { invalidFiles } = loadRecipes(dir);

    expect(invalidFiles).toEqual([]);
  });

  it("lets the Paytm Lever recipe page past its first 100 jobs (the board had 199)", () => {
    const dir = path.join(import.meta.dirname, "..", "..", "data", "companies");

    const paytm = loadRecipes(dir).recipes.find((recipe) => recipe.slug === "paytm");

    expect(paytm?.ats).toBe("lever");
    expect(paytm?.fetch?.pagination.maxPages).toBeGreaterThanOrEqual(2);
  });
});

describe("writeVerification", () => {
  it("changes only the verification fields and keeps the author's file otherwise intact", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme", { status: "unverified", verifiedOn: undefined, notes: "keep me" });

    writeVerification(dir, "acme", {
      status: "verified",
      verifiedOn: "2026-11-21",
      lastError: undefined,
    });

    const written = JSON.parse(readFileSync(path.join(dir, "acme.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(written).toEqual({
      ...recipeInput("acme", { status: "verified", verifiedOn: "2026-11-21", notes: "keep me" }),
    });
    expect(Object.keys(written)).toEqual([
      "slug",
      "name",
      "category",
      "careersUrl",
      "ats",
      "fetch",
      "status",
      "verifiedOn",
      "notes",
    ]);
    expect(readFileSync(path.join(dir, "acme.json"), "utf8").endsWith("}\n")).toBe(true);
    expect(readdirSync(dir)).toEqual(["acme.json"]);
  });

  it("removes lastError on success and records it on failure", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme", { status: "broken", lastError: "HTTP 404" });

    writeVerification(dir, "acme", {
      status: "verified",
      verifiedOn: "2026-11-21",
      lastError: undefined,
    });
    expect(loadRecipe(dir, "acme").lastError).toBeUndefined();

    writeVerification(dir, "acme", {
      status: "broken",
      verifiedOn: "2026-11-21",
      lastError: "HTTP 500",
    });
    expect(loadRecipe(dir, "acme")).toMatchObject({ status: "broken", lastError: "HTTP 500" });
  });

  it("refuses a patch that would make the file invalid and leaves the file untouched", () => {
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme", { status: "unverified", verifiedOn: undefined });
    const before = readFileSync(path.join(dir, "acme.json"), "utf8");

    expect(() =>
      writeVerification(dir, "acme", {
        status: "verified",
        verifiedOn: undefined,
        lastError: undefined,
      }),
    ).toThrow(/Refusing to write invalid recipe/);
    expect(readFileSync(path.join(dir, "acme.json"), "utf8")).toBe(before);
  });
});

describe("syncCompanies", () => {
  it("mirrors valid recipes into the companies table and never deletes rows", () => {
    const db = openDatabase(":memory:");
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme");
    writeRecipeFile(dir, "old-co");
    syncCompanies(db, dir);
    db.prepare("UPDATE companies SET last_success_at = 't' WHERE slug = 'acme'").run();

    writeRecipeFile(dir, "acme", { name: "Acme Renamed", status: "broken", lastError: "x" });
    writeRecipeFile(dir, "old-co", { category: "invalid" });
    const loaded = syncCompanies(db, dir);

    expect(loaded.invalidFiles.map((file) => file.file)).toEqual(["old-co.json"]);
    expect(getCompany(db, "acme")).toMatchObject({
      name: "Acme Renamed",
      status: "broken",
      lastSuccessAt: "t",
    });
    expect(getCompany(db, "old-co")).toBeDefined();
  });

  it("is idempotent", () => {
    const db = openDatabase(":memory:");
    const dir = makeTempDir();
    writeRecipeFile(dir, "acme");
    upsertCompany(db, {
      slug: "acme",
      name: "ACME",
      category: "cx-vendor",
      ats: "greenhouse",
      status: "verified",
    });

    syncCompanies(db, dir);
    syncCompanies(db, dir);

    expect(db.prepare("SELECT COUNT(*) AS n FROM companies").get()).toEqual({ n: 1 });
  });
});

describe("recipe file paths", () => {
  it("refuses a slug that would leave the recipes folder", () => {
    expect(() => recipeExists("/tmp/recipes", "../profile")).toThrow(/Invalid company slug/);
    expect(() => deleteRecipeFile("/tmp/recipes", "../profile")).toThrow(/Invalid company slug/);
  });
});
