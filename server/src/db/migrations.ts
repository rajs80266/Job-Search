import type { Db } from "./connection";

/** Append only. `PRAGMA user_version` stores how many have run. */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE companies (
    slug               TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    category           TEXT NOT NULL,
    ats                TEXT NOT NULL,
    status             TEXT NOT NULL,
    last_attempt_at    TEXT,
    first_success_at   TEXT,
    last_success_at    TEXT,
    last_refresh_error TEXT
  );

  CREATE TABLE jobs (
    id                    TEXT PRIMARY KEY,
    company_slug          TEXT NOT NULL REFERENCES companies(slug) ON DELETE CASCADE,
    external_id           TEXT NOT NULL,
    title                 TEXT NOT NULL,
    url                   TEXT NOT NULL,
    location_raw          TEXT NOT NULL,
    cities_json           TEXT NOT NULL,
    is_india              INTEGER NOT NULL,
    is_remote             INTEGER NOT NULL,
    posted_at             TEXT,
    first_seen_at         TEXT NOT NULL,
    last_seen_at          TEXT NOT NULL,
    closed_at             TEXT,
    description_snippet   TEXT NOT NULL,
    relevance_score       REAL NOT NULL,
    relevance_tier        TEXT NOT NULL CHECK (relevance_tier IN ('high','medium','low','none')),
    matched_keywords_json TEXT NOT NULL,
    UNIQUE (company_slug, external_id)
  );
  CREATE INDEX jobs_company_open ON jobs (company_slug, closed_at);
  CREATE INDEX jobs_rank        ON jobs (relevance_tier, relevance_score DESC);
  CREATE INDEX jobs_first_seen  ON jobs (first_seen_at);

  CREATE TABLE job_status (
    job_id     TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    status     TEXT CHECK (status IN ('saved','applied','interviewing','rejected','ignored')),
    notes      TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE refresh_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   TEXT NOT NULL,
    finished_at  TEXT,
    status       TEXT NOT NULL CHECK (status IN ('running','finished','aborted')),
    company_slug TEXT,
    full         INTEGER NOT NULL
  );

  CREATE TABLE refresh_company_results (
    run_id          INTEGER NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
    company_slug    TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ok','failed','skipped')),
    mode            TEXT NOT NULL CHECK (mode IN ('incremental','full')),
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    jobs_fetched    INTEGER NOT NULL DEFAULT 0,
    jobs_new        INTEGER NOT NULL DEFAULT 0,
    jobs_closed     INTEGER NOT NULL DEFAULT 0,
    jobs_invalid    INTEGER NOT NULL DEFAULT 0,
    pages_fetched   INTEGER NOT NULL DEFAULT 0,
    details_fetched INTEGER NOT NULL DEFAULT 0,
    details_failed  INTEGER NOT NULL DEFAULT 0,
    stop_reason     TEXT,
    message         TEXT,
    PRIMARY KEY (run_id, company_slug)
  );
  `,
];

export function runMigrations(db: Db, migrations: readonly string[] = MIGRATIONS): void {
  const applied = Number(db.pragma("user_version", { simple: true }));

  migrations.slice(applied).forEach((sql, offset) => {
    const version = applied + offset + 1;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  });
}
