import { parseArgs } from "node:util";
import { DB_PATH, PROFILE_PATH, RECIPES_DIR } from "../config";
import { adapterRegistry } from "../adapters";
import { openDatabase } from "../db/connection";
import { abortRunningRuns } from "../db/refresh-runs";
import { createHttpClient } from "../lib/http";
import { loadProfile } from "../profile/store";
import { createRefreshService } from "../refresh/service";
import { RefreshRequestSchema, type RefreshCompanyResult, type RefreshRunSummary } from "../types";

function formatResult(result: RefreshCompanyResult): string {
  const seconds =
    result.finishedAt === null
      ? 0
      : (Date.parse(result.finishedAt) - Date.parse(result.startedAt)) / 1000;
  const status = result.status === "ok" ? "ok" : result.status.toUpperCase();
  const counts =
    result.status === "ok"
      ? `fetched ${result.jobsFetched}, new ${result.jobsNew}, closed ${result.jobsClosed}`
      : (result.message ?? "");
  const note = result.status === "ok" && result.message ? ` (${result.message})` : "";
  return `${status.padEnd(7)} ${result.companySlug.padEnd(28)} ${counts}${note} [${seconds.toFixed(1)}s]`;
}

function formatTotals(run: RefreshRunSummary): string {
  const { totals } = run;
  return (
    `Run ${run.id} ${run.status}: ${totals.ok} ok, ${totals.failed} failed, ${totals.skipped} skipped; ` +
    `${totals.jobsNew} new, ${totals.jobsClosed} closed`
  );
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      company: { type: "string" },
      full: { type: "boolean", default: false },
    },
  });
  const request = RefreshRequestSchema.parse({ company: values.company, full: values.full });

  const db = openDatabase(DB_PATH);
  abortRunningRuns(db, new Date().toISOString());
  const service = createRefreshService({
    db,
    http: createHttpClient(),
    adapters: adapterRegistry,
    recipesDir: RECIPES_DIR,
    loadProfile: () => loadProfile(PROFILE_PATH),
  });

  const { runId, invalidFiles, done } = service.startRefresh(request);
  for (const { file, error } of invalidFiles)
    console.error(`Ignoring invalid recipe ${file}: ${error}`);
  service.events.subscribe(runId, (event) => {
    if (event.type === "company-finished") console.log(formatResult(event.result));
  });

  const run = await done;
  if (run.totals.companies === 0) {
    console.log("No refreshable companies. Recipes must pass `npm run verify:company` first.");
  }
  console.log(formatTotals(run));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
