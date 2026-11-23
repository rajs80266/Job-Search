import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PORT = Number(process.env["PORT"] ?? 3001);
export const DATA_DIR = process.env["DATA_DIR"] ?? path.join(serverRoot, "data");
export const DB_PATH = process.env["DB_PATH"] ?? path.join(DATA_DIR, "jobs.sqlite");
export const RECIPES_DIR = process.env["RECIPES_DIR"] ?? path.join(DATA_DIR, "companies");
export const PROFILE_PATH = process.env["PROFILE_PATH"] ?? path.join(DATA_DIR, "profile.json");

export const HTTP_RATE_LIMIT_MS = 1000;
export const HTTP_TIMEOUT_MS = 15_000;
export const HTTP_RETRY_BACKOFF_MS: readonly number[] = [1000, 3000];
export const HTTP_MAX_JITTER_MS = 250;
export const HTTP_MAX_RETRY_AFTER_MS = 10_000;
export const HTTP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const HTTP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0.0.0 Safari/537.36 india-cx-ai-job-tracker";

export const COMPANY_CONCURRENCY = 4;
export const COMPANY_BUDGET_MS = 120_000;
export const DETAIL_REQUESTS_PER_COMPANY = 20;
export const VERIFY_BUDGET_MS = 60_000;

/** A company needs this many jobs with descriptions before shared wording counts as boilerplate. */
export const BOILERPLATE_MIN_JOBS = 10;
/** A description-only concept found in at least this share of a company's jobs is boilerplate. */
export const BOILERPLATE_MIN_SHARE = 0.5;
/** Jobs not seen for this long are closed when a capped fetch can never reach the end. */
export const STALE_JOB_DAYS = 14;

export const SSE_PING_MS = 15_000;
