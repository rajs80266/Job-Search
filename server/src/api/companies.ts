import { Router } from "express";
import {
  type CompanyRow,
  companyHasUserData,
  countOpenIndiaJobs,
  deleteCompany,
  listCompanies,
} from "../db/companies";
import type { Db } from "../db/connection";
import { detectAtsFromUrl } from "../lib/detect-ats";
import { ParseRequestError, parseRequestText } from "../lib/parse-curl";
import {
  deleteRecipeFile,
  loadRecipe,
  loadRecipes,
  recipeExists,
  syncCompanies,
  writeRecipe,
} from "../recipes/store";
import { RecipeWriteError, resolveRecipeWrite } from "../recipes/write-rules";
import {
  NotVerifiableError,
  type VerifyDeps,
  verifyAndSaveRecipe,
  verifyRecipe,
} from "../refresh/verify";
import {
  type CompanyList,
  type CompanyRecipe,
  type CompanyRecipeDraft,
  CompanyRecipeSchema,
  type CompanySummary,
  type ImportCurlResponse,
  ImportCurlRequestSchema,
  SlugSchema,
  VerifyRequestSchema,
} from "../types";
import { ApiHttpError, conflict, notFound, parseOrThrow } from "./errors";

const GENERIC_WARNING =
  "No known ATS matched this URL, so the draft uses the generic adapter. Add a fieldMap (dot paths into the JSON response) before testing.";

function toSummary(
  recipe: CompanyRecipe,
  row: CompanyRow | undefined,
  counts: ReturnType<typeof countOpenIndiaJobs>,
): CompanySummary {
  return {
    recipe,
    runtime: {
      lastAttemptAt: row?.lastAttemptAt ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null,
      lastRefreshError: row?.lastRefreshError ?? null,
      openJobs: counts.get(recipe.slug)?.openJobs ?? 0,
      newJobs: counts.get(recipe.slug)?.newJobs ?? 0,
    },
  };
}

export function companiesRouter(db: Db, recipesDir: string, verifyDeps: VerifyDeps): Router {
  const router = Router();

  // Express decodes %2F in params, so an unchecked slug could point outside the recipes folder.
  router.param("slug", (_req, _res, next, slug: string) => {
    try {
      parseOrThrow(SlugSchema, slug);
      next();
    } catch (error) {
      next(error);
    }
  });

  const summaryOf = (recipe: CompanyRecipe): CompanySummary =>
    toSummary(
      recipe,
      listCompanies(db).find((row) => row.slug === recipe.slug),
      countOpenIndiaJobs(db),
    );

  const requireStored = (slug: string): CompanyRecipe => {
    if (!recipeExists(recipesDir, slug)) throw notFound(`No company "${slug}"`);
    try {
      return loadRecipe(recipesDir, slug);
    } catch (error) {
      throw conflict(error instanceof Error ? error.message : String(error));
    }
  };

  const saveResolved = (
    stored: CompanyRecipe | undefined,
    incoming: CompanyRecipe,
  ): CompanyRecipe => {
    try {
      const resolved = parseOrThrow(CompanyRecipeSchema, resolveRecipeWrite(stored, incoming));
      writeRecipe(recipesDir, resolved);
      syncCompanies(db, recipesDir);
      return resolved;
    } catch (error) {
      if (error instanceof RecipeWriteError) {
        throw new ApiHttpError(400, "validation", error.message);
      }
      throw error;
    }
  };

  router.get("/companies", (_req, res) => {
    const { recipes, invalidFiles } = loadRecipes(recipesDir);
    const rows = new Map(listCompanies(db).map((row) => [row.slug, row]));
    const counts = countOpenIndiaJobs(db);
    const body: CompanyList = {
      companies: recipes.map((recipe) => toSummary(recipe, rows.get(recipe.slug), counts)),
      invalidFiles,
    };
    res.json(body);
  });

  // Registered before "/companies/:slug" so "import-curl" is not read as a slug.
  router.post("/companies/import-curl", (req, res) => {
    const request = parseOrThrow(ImportCurlRequestSchema, req.body);
    let parsed;
    try {
      parsed = parseRequestText(request.text);
    } catch (error) {
      if (error instanceof ParseRequestError) {
        throw new ApiHttpError(400, "validation", error.message);
      }
      throw error;
    }

    const detectedAts = detectAtsFromUrl(parsed.url).ats;
    const draft: CompanyRecipeDraft = {
      ...(request.slug && { slug: request.slug }),
      ...(request.name && { name: request.name }),
      ...(request.category && { category: request.category }),
      ...(parsed.referer && { careersUrl: parsed.referer }),
      ats: detectedAts ?? "generic",
      fetch: {
        url: parsed.url,
        method: parsed.method,
        headers: parsed.headers,
        ...(parsed.body && { body: parsed.body }),
      },
      status: "unverified",
    };
    const body: ImportCurlResponse = {
      draft,
      strippedHeaders: parsed.strippedHeaders,
      detectedAts,
      warnings: [...parsed.warnings, ...(detectedAts ? [] : [GENERIC_WARNING])],
    };
    res.json(body);
  });

  router.get("/companies/:slug", (req, res) => {
    res.json(summaryOf(requireStored(req.params["slug"] ?? "")));
  });

  router.post("/companies", (req, res) => {
    const incoming = parseOrThrow(CompanyRecipeSchema, req.body);
    if (recipeExists(recipesDir, incoming.slug)) {
      throw conflict(`A company with slug "${incoming.slug}" already exists`);
    }
    res.status(201).json(summaryOf(saveResolved(undefined, incoming)));
  });

  router.put("/companies/:slug", (req, res) => {
    const slug = req.params["slug"] ?? "";
    const incoming = parseOrThrow(CompanyRecipeSchema, req.body);
    if (incoming.slug !== slug) {
      throw new ApiHttpError(400, "validation", `slug in the body must be "${slug}"`);
    }
    res.json(summaryOf(saveResolved(requireStored(slug), incoming)));
  });

  router.delete("/companies/:slug", (req, res) => {
    const slug = req.params["slug"] ?? "";
    if (!recipeExists(recipesDir, slug)) throw notFound(`No company "${slug}"`);
    if (companyHasUserData(db, slug)) {
      throw conflict(
        `"${slug}" has jobs with a status or notes. Disable it instead of deleting it.`,
      );
    }
    deleteRecipeFile(recipesDir, slug);
    deleteCompany(db, slug);
    res.status(204).end();
  });

  router.post("/companies/:slug/verify", async (req, res) => {
    const slug = req.params["slug"] ?? "";
    const { recipe } = parseOrThrow(VerifyRequestSchema, req.body ?? {});

    if (recipe) {
      if (recipe.slug !== slug) {
        throw new ApiHttpError(400, "validation", `slug in the body must be "${slug}"`);
      }
      res.json(await verifyRecipe(recipe, verifyDeps));
      return;
    }

    requireStored(slug);
    try {
      const result = await verifyAndSaveRecipe(recipesDir, slug, verifyDeps);
      syncCompanies(db, recipesDir);
      res.json(result);
    } catch (error) {
      if (error instanceof NotVerifiableError) throw conflict(error.message);
      throw error;
    }
  });

  return router;
}
