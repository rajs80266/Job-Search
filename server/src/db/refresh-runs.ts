import type {
  CompanyResultStatus,
  RefreshCompanyResult,
  RefreshMode,
  RefreshRunStatus,
  RefreshRunSummary,
  StopReason,
} from "../types";
import type { Db } from "./connection";

interface RawRunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: RefreshRunStatus;
  company_slug: string | null;
  full: number;
}

interface RawResultRow {
  run_id: number;
  company_slug: string;
  status: CompanyResultStatus;
  mode: RefreshMode;
  started_at: string;
  finished_at: string | null;
  jobs_fetched: number;
  jobs_new: number;
  jobs_closed: number;
  jobs_invalid: number;
  pages_fetched: number;
  details_fetched: number;
  details_failed: number;
  stop_reason: StopReason | null;
  message: string | null;
}

function toResult(row: RawResultRow): RefreshCompanyResult {
  return {
    runId: row.run_id,
    companySlug: row.company_slug,
    status: row.status,
    mode: row.mode,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    jobsFetched: row.jobs_fetched,
    jobsNew: row.jobs_new,
    jobsClosed: row.jobs_closed,
    jobsInvalid: row.jobs_invalid,
    pagesFetched: row.pages_fetched,
    detailsFetched: row.details_fetched,
    detailsFailed: row.details_failed,
    stopReason: row.stop_reason,
    message: row.message,
  };
}

export function startRun(
  db: Db,
  run: { companySlug: string | null; full: boolean; startedAt: string },
): number {
  const result = db
    .prepare(
      "INSERT INTO refresh_runs (started_at, status, company_slug, full) VALUES (?, 'running', ?, ?)",
    )
    .run(run.startedAt, run.companySlug, run.full ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function finishRun(
  db: Db,
  runId: number,
  status: Exclude<RefreshRunStatus, "running">,
  finishedAt: string,
): void {
  db.prepare("UPDATE refresh_runs SET status = ?, finished_at = ? WHERE id = ?").run(
    status,
    finishedAt,
    runId,
  );
}

/** For server start: a run left "running" by a crash will never finish. */
export function abortRunningRuns(db: Db, finishedAt: string): number {
  return db
    .prepare("UPDATE refresh_runs SET status = 'aborted', finished_at = ? WHERE status = 'running'")
    .run(finishedAt).changes;
}

export function insertCompanyResult(db: Db, result: RefreshCompanyResult): void {
  db.prepare(
    `INSERT INTO refresh_company_results (
       run_id, company_slug, status, mode, started_at, finished_at, jobs_fetched, jobs_new,
       jobs_closed, jobs_invalid, pages_fetched, details_fetched, details_failed, stop_reason, message
     ) VALUES (
       @runId, @companySlug, @status, @mode, @startedAt, @finishedAt, @jobsFetched, @jobsNew,
       @jobsClosed, @jobsInvalid, @pagesFetched, @detailsFetched, @detailsFailed, @stopReason, @message
     )`,
  ).run(result);
}

export function listCompanyResults(db: Db, runId: number): RefreshCompanyResult[] {
  const rows = db
    .prepare(
      "SELECT * FROM refresh_company_results WHERE run_id = ? ORDER BY started_at, company_slug",
    )
    .all(runId) as RawResultRow[];
  return rows.map(toResult);
}

export function getRunSummary(db: Db, runId: number): RefreshRunSummary | undefined {
  const run = db.prepare("SELECT * FROM refresh_runs WHERE id = ?").get(runId) as
    RawRunRow | undefined;
  if (!run) return undefined;

  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS companies,
         COALESCE(SUM(status = 'ok'), 0) AS ok,
         COALESCE(SUM(status = 'failed'), 0) AS failed,
         COALESCE(SUM(status = 'skipped'), 0) AS skipped,
         COALESCE(SUM(jobs_new), 0) AS jobsNew,
         COALESCE(SUM(jobs_closed), 0) AS jobsClosed
       FROM refresh_company_results WHERE run_id = ?`,
    )
    .get(runId) as RefreshRunSummary["totals"];

  return {
    id: run.id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
    companySlug: run.company_slug,
    full: run.full === 1,
    totals,
  };
}

export function getLatestRunSummary(db: Db): RefreshRunSummary | undefined {
  const latest = db.prepare("SELECT id FROM refresh_runs ORDER BY id DESC LIMIT 1").get() as
    { id: number } | undefined;
  return latest && getRunSummary(db, latest.id);
}
