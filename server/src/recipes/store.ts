import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { upsertCompany } from "../db/companies";
import type { Db } from "../db/connection";
import { formatZodIssues } from "../lib/zod-error";
import { type CompanyRecipe, CompanyRecipeSchema, SlugSchema } from "../types";

export interface InvalidRecipeFile {
  file: string;
  error: string;
}

export interface LoadedRecipes {
  recipes: CompanyRecipe[];
  invalidFiles: InvalidRecipeFile[];
}

/** Key order of recipe files, so rewrites keep diffs small. Unknown keys go last. */
const RECIPE_KEY_ORDER = [
  "slug",
  "name",
  "category",
  "careersUrl",
  "ats",
  "fetch",
  "fieldMap",
  "filters",
  "manualSearchUrl",
  "status",
  "verifiedOn",
  "lastError",
  "notes",
];

/** Fields that only verify:company may change. `undefined` removes the field. */
export interface VerificationPatch {
  status: CompanyRecipe["status"];
  verifiedOn: string | undefined;
  lastError: string | undefined;
}

function recipePath(recipesDir: string, slug: string): string {
  if (!SlugSchema.safeParse(slug).success) throw new Error(`Invalid company slug "${slug}"`);
  return path.join(recipesDir, `${slug}.json`);
}

function parseRecipeFile(filePath: string): CompanyRecipe {
  const result = CompanyRecipeSchema.safeParse(JSON.parse(readFileSync(filePath, "utf8")));
  if (!result.success) throw new Error(formatZodIssues(result.error));

  const expectedFile = `${result.data.slug}.json`;
  if (path.basename(filePath) !== expectedFile) {
    throw new Error(`file name must be ${expectedFile} (matching slug)`);
  }
  return result.data;
}

/** Reads every `*.json` in the folder; a missing folder is just "no companies yet". */
export function loadRecipes(recipesDir: string): LoadedRecipes {
  if (!existsSync(recipesDir)) return { recipes: [], invalidFiles: [] };

  const loaded: LoadedRecipes = { recipes: [], invalidFiles: [] };
  const files = readdirSync(recipesDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  for (const file of files) {
    try {
      loaded.recipes.push(parseRecipeFile(path.join(recipesDir, file)));
    } catch (error) {
      loaded.invalidFiles.push({
        file,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return loaded;
}

export function loadRecipe(recipesDir: string, slug: string): CompanyRecipe {
  const filePath = recipePath(recipesDir, slug);
  if (!existsSync(filePath)) throw new Error(`No recipe file for "${slug}" (${filePath})`);
  try {
    return parseRecipeFile(filePath);
  } catch (error) {
    throw new Error(
      `Invalid recipe ${slug}.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function writeRecipeFile(filePath: string, ordered: Record<string, unknown>): void {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(ordered, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
}

function inKeyOrder(recipe: Record<string, unknown>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const key of [...RECIPE_KEY_ORDER, ...Object.keys(recipe)]) {
    if (key in recipe && recipe[key] !== undefined) ordered[key] = recipe[key];
  }
  return ordered;
}

/** Writes a validated recipe (create or replace) atomically, in the usual key order. */
export function writeRecipe(recipesDir: string, recipe: CompanyRecipe): void {
  mkdirSync(recipesDir, { recursive: true });
  writeRecipeFile(recipePath(recipesDir, recipe.slug), inKeyOrder({ ...recipe }));
}

export function recipeExists(recipesDir: string, slug: string): boolean {
  return existsSync(recipePath(recipesDir, slug));
}

export function deleteRecipeFile(recipesDir: string, slug: string): void {
  rmSync(recipePath(recipesDir, slug), { force: true });
}

/**
 * Rewrites only the verification fields of the file on disk (not the schema defaults), validates
 * the result, and replaces the file atomically.
 */
export function writeVerification(
  recipesDir: string,
  slug: string,
  patch: VerificationPatch,
): CompanyRecipe {
  const filePath = recipePath(recipesDir, slug);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  const patched: Record<string, unknown> = { ...raw, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete patched[key];
  }

  const ordered = inKeyOrder(patched);

  const result = CompanyRecipeSchema.safeParse(ordered);
  if (!result.success) {
    throw new Error(
      `Refusing to write invalid recipe ${slug}.json: ${formatZodIssues(result.error)}`,
    );
  }

  writeRecipeFile(filePath, ordered);
  return result.data;
}

/**
 * Mirrors every valid recipe file into the companies table. Never deletes rows, so a file that
 * is temporarily invalid cannot wipe a company's jobs.
 */
export function syncCompanies(db: Db, recipesDir: string): LoadedRecipes {
  const loaded = loadRecipes(recipesDir);
  db.transaction(() => {
    for (const recipe of loaded.recipes) upsertCompany(db, recipe);
  })();
  return loaded;
}
