import { Router, type Response } from "express";
import { SSE_PING_MS } from "../config";
import type { Db } from "../db/connection";
import { getLatestRunSummary, getRunSummary, listCompanyResults } from "../db/refresh-runs";
import {
  RefreshAlreadyRunningError,
  type RefreshService,
  UnknownCompanyError,
} from "../refresh/service";
import { RefreshRequestSchema, type RefreshEvent, type RefreshStarted } from "../types";
import { ApiHttpError, conflict, notFound, parseOrThrow } from "./errors";

function writeEvent(res: Response, event: RefreshEvent): void {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function refreshRouter(db: Db, service: RefreshService): Router {
  const router = Router();

  router.post("/refresh", (req, res) => {
    const request = parseOrThrow(RefreshRequestSchema, req.body ?? {});
    try {
      const { runId, done } = service.startRefresh(request);
      done.catch((error: unknown) => {
        console.error(`Refresh run ${runId} crashed`, error);
      });
      const body: RefreshStarted = { runId };
      res.status(202).json(body);
    } catch (error) {
      if (error instanceof RefreshAlreadyRunningError) {
        throw conflict(error.message, { runId: error.runId });
      }
      if (error instanceof UnknownCompanyError) throw notFound(error.message);
      throw error;
    }
  });

  router.get("/refresh/latest", (_req, res) => {
    res.json(getLatestRunSummary(db) ?? null);
  });

  router.get("/refresh/:runId/events", (req, res) => {
    const runId = Number(req.params["runId"]);
    const run = Number.isInteger(runId) ? getRunSummary(db, runId) : undefined;
    if (!run) throw new ApiHttpError(404, "not-found", `No refresh run ${req.params["runId"]}`);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const isLive = run.status === "running" && service.getActiveRunId() === runId;
    writeEvent(res, {
      type: "snapshot",
      run,
      results: listCompanyResults(db, runId),
      running: isLive ? service.getRunningCompanies() : [],
    });
    if (!isLive) {
      res.end();
      return;
    }

    const cleanup = (): void => {
      unsubscribe();
      clearInterval(ping);
    };
    // Subscribing in the same tick as the snapshot read means no event can fall between them.
    const unsubscribe = service.events.subscribe(runId, (event) => {
      writeEvent(res, event);
      if (event.type === "run-finished") {
        cleanup();
        res.end();
      }
    });
    const ping = setInterval(() => res.write(": ping\n\n"), SSE_PING_MS);
    res.on("close", cleanup);
  });

  return router;
}
