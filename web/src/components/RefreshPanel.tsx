import type { RefreshRunSummary } from "@server/types";
import { formatAbsolute, formatDuration, formatRelative, pluralize } from "../lib/format";
import {
  buildProgressRows,
  countFinished,
  isRunActive,
  isStreamLost,
  type CompanyProgressRow,
  type CompanyProgressState,
  type RunProgress,
} from "../lib/refresh-progress";
import { CloseIcon, RefreshIcon, SpinnerIcon } from "./Icons";

interface RefreshControlsProps {
  latestRun: RefreshRunSummary | null | undefined;
  running: boolean;
  starting: boolean;
  fullRefresh: boolean;
  onFullRefreshChange: (full: boolean) => void;
  onStart: () => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  startError: string | null;
}

export function RefreshControls({
  latestRun,
  running,
  starting,
  fullRefresh,
  onFullRefreshChange,
  onStart,
  panelOpen,
  onTogglePanel,
  startError,
}: RefreshControlsProps) {
  const busy = running || starting;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="inline-flex h-9 items-center gap-2 rounded-sm bg-accent px-3.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-70"
      >
        {busy ? <SpinnerIcon /> : <RefreshIcon />}
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      <label
        className="flex items-center gap-1.5 text-sm"
        title="Reads every page instead of stopping at jobs already known, so jobs that closed are detected. Slower."
      >
        <input
          type="checkbox"
          checked={fullRefresh}
          disabled={busy}
          onChange={(event) => onFullRefreshChange(event.target.checked)}
          className="accent-accent"
        />
        Full refresh
      </label>
      {latestRun && (
        <button
          type="button"
          aria-expanded={panelOpen}
          aria-controls="refresh-panel"
          onClick={onTogglePanel}
          className="rounded-sm text-sm text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          {latestRun.status === "running" ? "Run in progress" : "Last run"}
          {latestRun.finishedAt ? ` ${formatRelative(latestRun.finishedAt)}` : ""}
          {latestRun.totals.failed > 0 && (
            <span className="font-medium text-danger"> · {latestRun.totals.failed} failed</span>
          )}
        </button>
      )}
      {startError && (
        <p role="alert" className="text-sm text-danger">
          {startError}
        </p>
      )}
    </div>
  );
}

const STATE_LABEL: Record<CompanyProgressState, string> = {
  running: "Fetching",
  pending: "Waiting",
  ok: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

const STATE_STYLE: Record<CompanyProgressState, string> = {
  running: "text-accent-strong",
  pending: "text-muted",
  ok: "text-ink",
  failed: "font-semibold text-danger",
  skipped: "text-muted",
};

function StateCell({ state }: { state: CompanyProgressState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${STATE_STYLE[state]}`}>
      {state === "running" && <SpinnerIcon className="size-3.5" />}
      {STATE_LABEL[state]}
    </span>
  );
}

function runHeadline(progress: RunProgress, done: number, total: number): string {
  const { run } = progress;
  if (!run) return "Connecting to the run…";
  if (run.status === "running")
    return `Refreshing ${done} of ${pluralize(total, "company", "companies")}`;
  if (run.status === "aborted") return "Run aborted before it finished";
  return `Finished ${pluralize(run.totals.companies, "company", "companies")}`;
}

function RunTotals({ progress }: { progress: RunProgress }) {
  const rows = Object.values(progress.results);
  const count = (status: string): number => rows.filter((row) => row.status === status).length;
  const sum = (pick: (row: (typeof rows)[number]) => number): number =>
    rows.reduce((total, row) => total + pick(row), 0);
  return (
    <p className="text-sm text-muted">
      <span className="font-mono text-ink">{count("ok")}</span> ok ·{" "}
      <span className={`font-mono ${count("failed") ? "font-semibold text-danger" : "text-ink"}`}>
        {count("failed")}
      </span>{" "}
      failed · <span className="font-mono text-ink">{count("skipped")}</span> skipped ·{" "}
      <span className="font-mono text-ink">{sum((row) => row.jobsNew)}</span> new ·{" "}
      <span className="font-mono text-ink">{sum((row) => row.jobsClosed)}</span> closed
    </p>
  );
}

function IssueList({
  title,
  tone,
  rows,
  names,
}: {
  title: string;
  tone: "error" | "warning";
  rows: CompanyProgressRow[];
  names: ReadonlyMap<string, string>;
}) {
  if (rows.length === 0) return null;
  const style =
    tone === "error"
      ? "border-danger/40 bg-danger-soft text-danger"
      : "border-caution/40 bg-caution-soft text-caution";
  return (
    <section aria-label={title} className={`rounded-sm border p-3 ${style}`}>
      <h3 className="text-sm font-semibold">
        {title} ({rows.length})
      </h3>
      <ul className="mt-1.5 space-y-1 text-sm">
        {rows.map((row) => (
          <li key={row.slug}>
            <span className="font-medium">{names.get(row.slug) ?? row.slug}</span>
            {": "}
            {row.result?.message || "No details were recorded."}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RefreshPanelProps {
  progress: RunProgress;
  plannedSlugs: readonly string[];
  companyNames: ReadonlyMap<string, string>;
  onClose: () => void;
}

export function RefreshPanel({ progress, plannedSlugs, companyNames, onClose }: RefreshPanelProps) {
  const rows = buildProgressRows(progress, plannedSlugs);
  const done = countFinished(progress);
  const total = Math.max(rows.length, done);
  const active = isRunActive(progress);
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const failed = rows.filter((row) => row.state === "failed");
  const warnings = rows.filter((row) => row.state === "ok" && row.result?.message);
  const nameOf = (slug: string): string => companyNames.get(slug) ?? slug;

  return (
    <section
      id="refresh-panel"
      aria-label="Refresh progress"
      className="border border-line bg-surface"
    >
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold" aria-live="polite">
            {runHeadline(progress, done, total)}
          </h2>
          {progress.run && (
            <p className="text-xs text-muted">
              Run {progress.run.id} · {progress.run.full ? "full" : "incremental"} · started{" "}
              {formatAbsolute(progress.run.startedAt)}
            </p>
          )}
          {isStreamLost(progress) && (
            <p role="status" className="text-xs font-medium text-caution">
              Connection to the server was lost. Reload the page to see how the run ended.
            </p>
          )}
          {progress.connection === "reconnecting" && (
            <p role="status" className="text-xs font-medium text-caution">
              Connection lost, reconnecting…
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide refresh details"
          className="rounded-sm p-1 text-muted hover:bg-sunken hover:text-ink"
        >
          <CloseIcon />
        </button>
      </header>

      <div className="space-y-3 px-4 py-3">
        <div
          role="progressbar"
          aria-label="Companies refreshed"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="h-2 overflow-hidden rounded-full bg-sunken"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${active ? "bg-accent" : failed.length > 0 ? "bg-caution" : "bg-accent-strong"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <RunTotals progress={progress} />

        <div aria-live="polite" className="space-y-2">
          <IssueList title="Errors" tone="error" rows={failed} names={companyNames} />
          <IssueList title="Warnings" tone="warning" rows={warnings} names={companyNames} />
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted">
            {progress.run
              ? "No companies were refreshed. Recipes must pass verify:company before they are refreshed."
              : "Waiting for the first update…"}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Per-company refresh progress</caption>
              <thead className="sticky top-0 bg-sunken text-xs text-muted">
                <tr>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    Company
                  </th>
                  <th scope="col" className="px-3 py-1.5 font-medium">
                    State
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Fetched
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    New
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Closed
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-right font-medium">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.slug} className="border-t border-line">
                    <th scope="row" className="px-3 py-1 font-medium">
                      {nameOf(row.slug)}
                    </th>
                    <td className="px-3 py-1">
                      <StateCell state={row.state} />
                    </td>
                    <NumberCell
                      value={row.result?.status === "ok" ? row.result.jobsFetched : null}
                    />
                    <NumberCell
                      value={row.result?.status === "ok" ? row.result.jobsNew : null}
                      highlight
                    />
                    <NumberCell
                      value={row.result?.status === "ok" ? row.result.jobsClosed : null}
                    />
                    <td className="px-3 py-1 text-right font-mono text-xs text-muted">
                      {row.result
                        ? formatDuration(row.result.startedAt, row.result.finishedAt)
                        : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function NumberCell({ value, highlight = false }: { value: number | null; highlight?: boolean }) {
  return (
    <td
      className={`px-3 py-1 text-right font-mono text-xs ${highlight && value ? "font-semibold text-caution" : "text-muted"}`}
    >
      {value ?? ""}
    </td>
  );
}
