import type { JobStatus, JobStatusRecord, JobStatusUpdate } from "../types";
import type { Db } from "./connection";

interface RawJobStatusRow {
  job_id: string;
  status: JobStatus | null;
  notes: string;
  updated_at: string;
}

function toRecord(row: RawJobStatusRow): JobStatusRecord {
  return { jobId: row.job_id, status: row.status, notes: row.notes, updatedAt: row.updated_at };
}

export function getJobStatus(db: Db, jobId: string): JobStatusRecord | undefined {
  const row = db.prepare("SELECT * FROM job_status WHERE job_id = ?").get(jobId) as
    RawJobStatusRow | undefined;
  return row && toRecord(row);
}

/** Only the given fields change: `status: null` clears the status, `notes: ""` clears notes. */
export function upsertJobStatus(
  db: Db,
  jobId: string,
  update: JobStatusUpdate,
  updatedAt: string,
): JobStatusRecord {
  const existing = getJobStatus(db, jobId);
  const status = update.status === undefined ? (existing?.status ?? null) : update.status;
  const notes = update.notes ?? existing?.notes ?? "";

  db.prepare(
    `INSERT INTO job_status (job_id, status, notes, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET
       status = excluded.status, notes = excluded.notes, updated_at = excluded.updated_at`,
  ).run(jobId, status, notes, updatedAt);

  return { jobId, status, notes, updatedAt };
}
