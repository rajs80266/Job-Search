import express, { type Express } from "express";
import { apiErrorHandler, unknownApiRoute } from "./api/errors";
import { companiesRouter } from "./api/companies";
import { jobsRouter } from "./api/jobs";
import { requireJsonBody, requireLocalHost } from "./api/local-only";
import { profileRouter } from "./api/profile";
import { statsRouter } from "./api/stats";
import { refreshRouter } from "./api/refresh";
import type { Db } from "./db/connection";
import type { RefreshService } from "./refresh/service";
import type { AdapterRegistry, HttpClient, Profile } from "./types";

export interface AppDeps {
  db: Db;
  refreshService: RefreshService;
  recipesDir: string;
  /** The one shared client, so the per-host rate limit holds across verify calls and refreshes. */
  http: HttpClient;
  adapters: AdapterRegistry;
  loadProfile: () => Profile;
  saveProfile: (profile: Profile) => void;
  now?: () => Date;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use("/api", requireLocalHost, requireJsonBody, express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  const now = deps.now ?? (() => new Date());
  app.use(
    "/api",
    jobsRouter(deps.db, now),
    refreshRouter(deps.db, deps.refreshService),
    companiesRouter(deps.db, deps.recipesDir, {
      http: deps.http,
      adapters: deps.adapters,
      now,
    }),
    profileRouter({
      db: deps.db,
      recipesDir: deps.recipesDir,
      refreshService: deps.refreshService,
      loadProfile: deps.loadProfile,
      saveProfile: deps.saveProfile,
    }),
    statsRouter(deps.db, now),
    unknownApiRoute,
  );
  app.use(apiErrorHandler);

  return app;
}
