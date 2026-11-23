import { Router } from "express";
import { upsertJobStatus } from "../db/job-status";
import { queryJobs } from "../db/job-queries";
import { getJob } from "../db/jobs";
import type { Db } from "../db/connection";
import { JobStatusUpdateSchema, JobsQuerySchema } from "../types";
import { notFound, parseOrThrow } from "./errors";

export function jobsRouter(db: Db, now: () => Date): Router {
  const router = Router();

  router.get("/jobs", (req, res) => {
    res.json(queryJobs(db, parseOrThrow(JobsQuerySchema, req.query)));
  });

  router.patch("/jobs/:id/status", (req, res) => {
    const jobId = req.params["id"] ?? "";
    const update = parseOrThrow(JobStatusUpdateSchema, req.body);
    if (!getJob(db, jobId)) throw notFound(`No job ${jobId}`);
    res.json(upsertJobStatus(db, jobId, update, now().toISOString()));
  });

  return router;
}
