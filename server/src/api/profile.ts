import { Router } from "express";
import type { Db } from "../db/connection";
import { rescoreStoredJobs } from "../profile/rescore";
import { loadRecipes } from "../recipes/store";
import type { RefreshService } from "../refresh/service";
import { type Profile, ProfileSchema, type ProfileSaveResponse } from "../types";
import { conflict, parseOrThrow } from "./errors";

export interface ProfileRouterDeps {
  db: Db;
  recipesDir: string;
  refreshService: RefreshService;
  loadProfile: () => Profile;
  saveProfile: (profile: Profile) => void;
}

export function profileRouter(deps: ProfileRouterDeps): Router {
  const router = Router();

  router.get("/profile", (_req, res) => {
    res.json(deps.loadProfile());
  });

  router.put("/profile", (req, res) => {
    const profile = parseOrThrow(ProfileSchema, req.body);
    const dryRun = req.query["dryRun"] === "true";
    if (!dryRun && deps.refreshService.getActiveRunId() !== null) {
      throw conflict("A refresh is running. Save the profile when it has finished.");
    }

    const indiaFiltered = new Map(
      loadRecipes(deps.recipesDir).recipes.map((recipe) => [
        recipe.slug,
        recipe.filters.indiaFiltered,
      ]),
    );

    // One transaction: if writing the file fails, no job keeps a score from the new profile.
    const result = deps.db.transaction(() => {
      const rescored = rescoreStoredJobs(deps.db, profile, indiaFiltered, { write: !dryRun });
      if (!dryRun) deps.saveProfile(profile);
      return rescored;
    })();

    const body: ProfileSaveResponse = { saved: !dryRun, ...result };
    res.json(body);
  });

  return router;
}
