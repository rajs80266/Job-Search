import { localDateString } from "../lib/dates";
import {
  JOB_STATUSES,
  RELEVANCE_TIERS,
  type JobStatus,
  type Stats,
  type TierCounts,
} from "../types";
import type { Db } from "./connection";
import { IS_NEW_SQL } from "./job-queries";
import { getLatestRunSummary } from "./refresh-runs";

export const NEW_PER_DAY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const OPEN_INDIA = "j.closed_at IS NULL AND j.is_india = 1";

/** The last `days` local dates, oldest first, ending today. */
function recentDates(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, index) =>
    localDateString(new Date(now.getTime() - (days - 1 - index) * DAY_MS)),
  );
}

function tierCounts(db: Db): TierCounts {
  const counts = Object.fromEntries(RELEVANCE_TIERS.map((tier) => [tier, 0])) as TierCounts;
  const rows = db
    .prepare(
      `SELECT j.relevance_tier AS tier, COUNT(*) AS count FROM jobs j WHERE ${OPEN_INDIA} GROUP BY j.relevance_tier`,
    )
    .all() as { tier: keyof TierCounts; count: number }[];
  for (const row of rows) counts[row.tier] = row.count;
  return counts;
}

function funnel(db: Db): Stats["funnel"] {
  const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0])) as Record<
    JobStatus,
    number
  >;
  const rows = db
    .prepare(
      "SELECT status, COUNT(*) AS count FROM job_status WHERE status IS NOT NULL GROUP BY status",
    )
    .all() as { status: JobStatus; count: number }[];
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

function newPerDay(db: Db, now: Date): Stats["newPerDay"] {
  const dates = recentDates(now, NEW_PER_DAY_WINDOW_DAYS);
  const rows = db
    .prepare(
      `SELECT date(j.first_seen_at, 'localtime') AS date, COUNT(*) AS count,
              COALESCE(SUM(j.relevance_tier IN ('high', 'medium')), 0) AS highOrMedium
       FROM jobs j JOIN companies c ON c.slug = j.company_slug
       WHERE ${OPEN_INDIA}
         AND j.first_seen_at > c.first_success_at
         AND date(j.first_seen_at, 'localtime') >= ?
       GROUP BY date`,
    )
    .all(dates[0]) as { date: string; count: number; highOrMedium: number }[];
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return dates.map((date) => ({
    date,
    count: byDate.get(date)?.count ?? 0,
    highOrMedium: byDate.get(date)?.highOrMedium ?? 0,
  }));
}

function perCompany(db: Db): Stats["perCompany"] {
  return db
    .prepare(
      `SELECT c.slug AS slug, c.name AS name, COUNT(*) AS open,
              COALESCE(SUM(${IS_NEW_SQL}), 0) AS new,
              COALESCE(SUM(j.relevance_tier = 'high'), 0) AS high,
              COALESCE(SUM(j.relevance_tier = 'medium'), 0) AS medium
       FROM jobs j JOIN companies c ON c.slug = j.company_slug
       WHERE ${OPEN_INDIA}
       GROUP BY c.slug
       ORDER BY high + medium DESC, open DESC, name`,
    )
    .all() as Stats["perCompany"];
}

export function getStats(db: Db, now: Date): Stats {
  return {
    newPerDay: newPerDay(db, now),
    perCompany: perCompany(db),
    funnel: funnel(db),
    tiers: tierCounts(db),
    lastRun: getLatestRunSummary(db) ?? null,
  };
}
