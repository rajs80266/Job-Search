import type { RefreshCompanyResult, RefreshEvent, RefreshRunSummary } from "@server/types";

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

export interface RunProgress {
  run: RefreshRunSummary | null;
  /** Finished companies by slug. */
  results: Record<string, RefreshCompanyResult>;
  /** Started but not finished, in start order. */
  running: string[];
  connection: ConnectionState;
}

export const EMPTY_PROGRESS: RunProgress = {
  run: null,
  results: {},
  running: [],
  connection: "connecting",
};

export type ProgressAction = RefreshEvent | { type: "connection"; state: ConnectionState };

/** Applying an event twice gives the same state, so a reconnect that resends a snapshot is safe. */
export function applyProgressAction(state: RunProgress, action: ProgressAction): RunProgress {
  switch (action.type) {
    case "connection":
      return { ...state, connection: action.state };
    case "snapshot":
      return {
        ...state,
        run: action.run,
        results: Object.fromEntries(action.results.map((result) => [result.companySlug, result])),
        running: action.running,
      };
    case "company-started":
      return state.results[action.companySlug] || state.running.includes(action.companySlug)
        ? state
        : { ...state, running: [...state.running, action.companySlug] };
    case "company-finished":
      return {
        ...state,
        results: { ...state.results, [action.result.companySlug]: action.result },
        running: state.running.filter((slug) => slug !== action.result.companySlug),
      };
    case "run-finished":
      return { ...state, run: action.run, running: [] };
  }
}

export type CompanyProgressState = "running" | "pending" | RefreshCompanyResult["status"];

export interface CompanyProgressRow {
  slug: string;
  state: CompanyProgressState;
  result: RefreshCompanyResult | null;
}

const STATE_ORDER: Record<CompanyProgressState, number> = {
  running: 0,
  failed: 1,
  ok: 2,
  skipped: 3,
  pending: 4,
};

/**
 * One row per planned company. Running first, then failed, ok and skipped (most recent first
 * within each), then pending in planned order.
 */
export function buildProgressRows(
  progress: RunProgress,
  plannedSlugs: readonly string[],
): CompanyProgressRow[] {
  const slugs = [
    ...new Set([...plannedSlugs, ...Object.keys(progress.results), ...progress.running]),
  ];
  const rows = slugs.map((slug): CompanyProgressRow => {
    const result = progress.results[slug] ?? null;
    const state: CompanyProgressState = result
      ? result.status
      : progress.running.includes(slug)
        ? "running"
        : "pending";
    return { slug, state, result };
  });

  const finishedAt = (row: CompanyProgressRow): string => row.result?.finishedAt ?? "";
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byState = STATE_ORDER[a.row.state] - STATE_ORDER[b.row.state];
      if (byState !== 0) return byState;
      if (a.row.result && b.row.result) return finishedAt(b.row).localeCompare(finishedAt(a.row));
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

export function countFinished(progress: RunProgress): number {
  return Object.keys(progress.results).length;
}

export function isRunActive(progress: RunProgress): boolean {
  return progress.run?.status === "running";
}

/** True when the event says the run is over: the final event, or a snapshot of a run that already ended. */
export function eventEndsRun(event: RefreshEvent): boolean {
  return (
    event.type === "run-finished" || (event.type === "snapshot" && event.run.status !== "running")
  );
}

/** The stream is gone but the last known state still says "running": the page cannot tell more. */
export function isStreamLost(progress: RunProgress): boolean {
  return progress.connection === "closed" && isRunActive(progress);
}
