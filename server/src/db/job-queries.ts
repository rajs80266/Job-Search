import type { JobListItem, JobsQuery, JobStatus, Page } from "../types";
import type { Db } from "./connection";
import { type RawJobRow, toNormalizedJob } from "./jobs";

/**
 * A job is new when it first appeared in its company's latest successful fetch, and that fetch
 * was not the baseline (ARCHITECTURE §6). Expects `jobs j` joined with `companies c`.
 */
export const IS_NEW_SQL = `COALESCE(
  j.first_seen_at >= c.last_success_at AND j.first_seen_at > c.first_success_at, 0)`;

const ORDER_BY: Record<JobsQuery["sort"], string> = {
  relevance: "j.relevance_score DESC, j.first_seen_at DESC, j.id",
  posted: "j.posted_at IS NULL, j.posted_at DESC, j.id",
  firstSeen: "j.first_seen_at DESC, j.id",
};

interface JobListRow extends RawJobRow {
  company_name: string;
  category: JobListItem["category"];
  is_new: number;
  status: JobStatus | null;
  notes: string;
  status_updated_at: string | null;
}

interface Where {
  clauses: string[];
  params: (string | number)[];
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function inList(column: string, values: readonly string[], where: Where): void {
  where.clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  where.params.push(...values);
}

function buildWhere(query: JobsQuery): Where {
  const where: Where = { clauses: [], params: [] };

  if (query.q !== undefined) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.clauses.push(
      `(j.title LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
        OR j.location_raw LIKE ? ESCAPE '\\' OR j.description_snippet LIKE ? ESCAPE '\\')`,
    );
    where.params.push(pattern, pattern, pattern, pattern);
  }
  if (query.company) inList("j.company_slug", query.company, where);
  if (query.category) inList("c.category", query.category, where);
  if (query.tier) inList("j.relevance_tier", query.tier, where);
  if (query.city !== undefined) {
    where.clauses.push("EXISTS (SELECT 1 FROM json_each(j.cities_json) WHERE value = ?)");
    where.params.push(query.city);
  }

  if (query.status === undefined) where.clauses.push("(s.status IS NULL OR s.status <> 'ignored')");
  else if (query.status === "none") where.clauses.push("s.status IS NULL");
  else {
    where.clauses.push("s.status = ?");
    where.params.push(query.status);
  }

  if (query.isNew !== undefined) where.clauses.push(`${IS_NEW_SQL} = ${query.isNew ? 1 : 0}`);
  if (query.india !== "all") where.clauses.push(`j.is_india = ${query.india === "true" ? 1 : 0}`);
  if (query.remote !== undefined) where.clauses.push(`j.is_remote = ${query.remote ? 1 : 0}`);
  if (!query.includeClosed) where.clauses.push("j.closed_at IS NULL");

  return where;
}

const FROM_SQL = `FROM jobs j
  JOIN companies c ON c.slug = j.company_slug
  LEFT JOIN job_status s ON s.job_id = j.id`;

function toListItem(row: JobListRow): JobListItem {
  return {
    ...toNormalizedJob(row),
    companyName: row.company_name,
    category: row.category,
    isNew: row.is_new === 1,
    status: row.status,
    notes: row.notes,
    statusUpdatedAt: row.status_updated_at,
  };
}

export function queryJobs(db: Db, query: JobsQuery): Page<JobListItem> {
  const where = buildWhere(query);
  const whereSql = where.clauses.length > 0 ? `WHERE ${where.clauses.join(" AND ")}` : "";

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total ${FROM_SQL} ${whereSql}`)
    .get(...where.params) as { total: number };

  const rows = db
    .prepare(
      `SELECT j.*, c.name AS company_name, c.category AS category, ${IS_NEW_SQL} AS is_new,
              s.status AS status, COALESCE(s.notes, '') AS notes, s.updated_at AS status_updated_at
       ${FROM_SQL} ${whereSql}
       ORDER BY ${ORDER_BY[query.sort]}
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, query.pageSize, (query.page - 1) * query.pageSize) as JobListRow[];

  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize };
}
