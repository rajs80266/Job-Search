import type { Ats, CompanyCategory, CompanyRecipe, RecipeStatus } from "../types";
import type { Db } from "./connection";
import { IS_NEW_SQL } from "./job-queries";

export interface CompanyRow {
  slug: string;
  name: string;
  category: CompanyCategory;
  ats: Ats;
  status: RecipeStatus;
  lastAttemptAt: string | null;
  firstSuccessAt: string | null;
  lastSuccessAt: string | null;
  lastRefreshError: string | null;
}

interface RawCompanyRow {
  slug: string;
  name: string;
  category: CompanyCategory;
  ats: Ats;
  status: RecipeStatus;
  last_attempt_at: string | null;
  first_success_at: string | null;
  last_success_at: string | null;
  last_refresh_error: string | null;
}

function toCompanyRow(row: RawCompanyRow): CompanyRow {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    ats: row.ats,
    status: row.status,
    lastAttemptAt: row.last_attempt_at,
    firstSuccessAt: row.first_success_at,
    lastSuccessAt: row.last_success_at,
    lastRefreshError: row.last_refresh_error,
  };
}

/** Mirrors the recipe file; leaves the runtime columns alone. */
export function upsertCompany(
  db: Db,
  recipe: Pick<CompanyRecipe, "slug" | "name" | "category" | "ats" | "status">,
): void {
  db.prepare(
    `INSERT INTO companies (slug, name, category, ats, status)
     VALUES (@slug, @name, @category, @ats, @status)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name, category = excluded.category,
       ats = excluded.ats, status = excluded.status`,
  ).run(recipe);
}

export function getCompany(db: Db, slug: string): CompanyRow | undefined {
  const row = db.prepare("SELECT * FROM companies WHERE slug = ?").get(slug) as
    RawCompanyRow | undefined;
  return row && toCompanyRow(row);
}

export function listCompanies(db: Db): CompanyRow[] {
  const rows = db.prepare("SELECT * FROM companies ORDER BY slug").all() as RawCompanyRow[];
  return rows.map(toCompanyRow);
}

export function recordCompanyFailure(db: Db, slug: string, at: string, message: string): void {
  db.prepare("UPDATE companies SET last_attempt_at = ?, last_refresh_error = ? WHERE slug = ?").run(
    at,
    message,
    slug,
  );
}

/** `fetchedAt` is the fetch time; the first success becomes the company's baseline. */
export function recordCompanySuccess(db: Db, slug: string, fetchedAt: string): void {
  db.prepare(
    `UPDATE companies SET
       last_attempt_at = @fetchedAt,
       last_success_at = @fetchedAt,
       first_success_at = COALESCE(first_success_at, @fetchedAt),
       last_refresh_error = NULL
     WHERE slug = @slug`,
  ).run({ slug, fetchedAt });
}

export interface CompanyJobCounts {
  openJobs: number;
  newJobs: number;
}

/** Open India jobs per company: all of them, and those that are new. */
export function countOpenIndiaJobs(db: Db): Map<string, CompanyJobCounts> {
  const rows = db
    .prepare(
      `SELECT c.slug AS slug, COUNT(*) AS openJobs, COALESCE(SUM(${IS_NEW_SQL}), 0) AS newJobs
       FROM jobs j JOIN companies c ON c.slug = j.company_slug
       WHERE j.closed_at IS NULL AND j.is_india = 1
       GROUP BY c.slug`,
    )
    .all() as (CompanyJobCounts & { slug: string })[];
  return new Map(rows.map(({ slug, ...counts }) => [slug, counts]));
}

/** True when the user saved a status or notes on any of the company's jobs. */
export function companyHasUserData(db: Db, slug: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM job_status s JOIN jobs j ON j.id = s.job_id
         WHERE j.company_slug = ? AND (s.status IS NOT NULL OR s.notes <> '') LIMIT 1`,
      )
      .get(slug) !== undefined
  );
}

/** Removes the company row and, by cascade, its jobs. */
export function deleteCompany(db: Db, slug: string): void {
  db.prepare("DELETE FROM companies WHERE slug = ?").run(slug);
}
