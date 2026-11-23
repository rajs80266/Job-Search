import { Router } from "express";
import type { Db } from "../db/connection";
import { getStats } from "../db/stats";

export function statsRouter(db: Db, now: () => Date): Router {
  const router = Router();

  router.get("/stats", (_req, res) => {
    res.json(getStats(db, now()));
  });

  return router;
}
