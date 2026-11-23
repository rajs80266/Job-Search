import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "./migrations";

export type Db = Database.Database;

/** Opens (and migrates) the database. Pass ":memory:" in tests. */
export function openDatabase(filename: string): Db {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
