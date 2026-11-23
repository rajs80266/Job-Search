import type { ReactNode } from "react";
import type { JobStatus, RelevanceTier, Stats } from "@server/types";
import { Link } from "react-router-dom";
import { useStats } from "../api/hooks";
import { EmptyState, ErrorState } from "../components/StateViews";
import { barShapes, shortDate, sharePercent } from "../lib/chart";
import { formatAbsolute, formatRelative } from "../lib/format";
import { STATUS_LABELS, TIERS, TIER_LABELS } from "../lib/labels";

const TOP_COMPANIES = 10;
const FUNNEL_STEPS = ["saved", "applied", "interviewing", "rejected"] as const;

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border border-line bg-surface">
      <header className="border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="text-xs text-muted">{note}</p>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TierStrip({ tiers }: { tiers: Stats["tiers"] }) {
  const total = TIERS.reduce((sum, tier) => sum + tiers[tier], 0);
  return (
    <section aria-label="Open India jobs by tier">
      <dl className="grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
        {TIERS.map((tier) => (
          <Link
            key={tier}
            to={`/?tier=${tier}`}
            className="group bg-surface px-4 py-3 hover:bg-accent-soft/40"
            aria-label={`${tiers[tier]} ${TIER_LABELS[tier]} jobs, open them`}
          >
            <dt className="text-xs text-muted group-hover:text-ink">{TIER_LABELS[tier]}</dt>
            <dd className={`font-mono text-2xl ${tier === "high" ? "text-accent" : ""}`}>
              {tiers[tier]}
            </dd>
          </Link>
        ))}
        <div className="bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Open India jobs</dt>
          <dd className="font-mono text-2xl">{total}</dd>
        </div>
      </dl>
    </section>
  );
}

function NewPerDay({ days }: { days: Stats["newPerDay"] }) {
  const shapes = barShapes(days);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const strong = days.reduce((sum, day) => sum + day.highOrMedium, 0);
  const max = Math.max(0, ...days.map((day) => day.count));
  const first = days[0];
  const last = days.at(-1);

  return (
    <Section
      title="New roles per day"
      note="Open India jobs that first appeared in a refresh after the company's first fetch. Last 30 days."
    >
      <p className="mb-3 text-sm">
        <span className="font-mono text-lg">{total}</span> new, of which{" "}
        <span className="font-mono text-lg text-accent">{strong}</span> high or medium
      </p>
      <div className="flex gap-2">
        <span
          className="flex w-6 flex-col justify-between text-right font-mono text-[0.6875rem] text-muted"
          aria-hidden="true"
        >
          <span>{max}</span>
          <span>0</span>
        </span>
        <div
          className="flex h-40 flex-1 items-end gap-[3px] border-b border-line"
          role="img"
          aria-label={`Bar chart of new roles per day. ${total} new roles in 30 days, ${strong} of them high or medium.`}
        >
          {days.map((day, index) => {
            const shape = shapes[index];
            return (
              <div
                key={day.date}
                className="flex h-full flex-1 flex-col justify-end"
                title={`${shortDate(day.date)}: ${day.count} new (${day.highOrMedium} high or medium)`}
              >
                <div
                  className="flex min-h-0 flex-col justify-end overflow-hidden rounded-t-[2px] bg-line transition-[height] duration-500"
                  style={{ height: `${shape?.totalPercent ?? 0}%` }}
                >
                  <div className="bg-accent" style={{ height: `${shape?.strongPercent ?? 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 ml-8 flex justify-between text-xs text-muted">
        <span>{first && shortDate(first.date)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 bg-accent" /> High or medium
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block size-2.5 bg-line" /> Other
          </span>
        </span>
        <span>{last && shortDate(last.date)}</span>
      </div>
      <details className="mt-3 text-sm">
        <summary className="text-muted">Show as a table</summary>
        <table className="mt-2 w-full max-w-md border-collapse text-left text-xs">
          <caption className="sr-only">New roles per day</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 font-medium">
                Day
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                New
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                High or medium
              </th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((day) => (
              <tr key={day.date} className="border-t border-line">
                <th scope="row" className="py-1 font-normal">
                  {shortDate(day.date)}
                </th>
                <td className="py-1 text-right font-mono">{day.count}</td>
                <td className="py-1 text-right font-mono">{day.highOrMedium}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Section>
  );
}

function TopCompanies({ companies }: { companies: Stats["perCompany"] }) {
  const ranked = companies
    .filter((company) => company.high + company.medium > 0)
    .slice(0, TOP_COMPANIES);
  const max = Math.max(1, ...ranked.map((company) => company.high + company.medium));

  return (
    <Section
      title="Top companies"
      note="Open India jobs rated high or medium. Select a company to see them."
    >
      {ranked.length === 0 ? (
        <p className="text-sm text-muted">No company has a high or medium job yet.</p>
      ) : (
        <ol className="space-y-2">
          {ranked.map((company) => (
            <li key={company.slug}>
              <Link
                to={`/?company=${company.slug}&tier=high,medium`}
                className="group grid grid-cols-[9rem_1fr_11rem] items-center gap-3 text-sm"
              >
                <span className="truncate font-medium group-hover:text-accent group-hover:underline">
                  {company.name}
                </span>
                <span
                  className="flex h-3 overflow-hidden rounded-[2px] bg-sunken"
                  role="img"
                  aria-label={`${company.high} high and ${company.medium} medium`}
                >
                  <span className="bg-accent" style={{ width: `${(company.high / max) * 100}%` }} />
                  <span
                    className="bg-accent/40"
                    style={{ width: `${(company.medium / max) * 100}%` }}
                  />
                </span>
                <span className="font-mono text-xs text-muted">
                  <span className="text-ink">{company.high}</span> high ·{" "}
                  <span className="text-ink">{company.medium}</span> med
                  {company.new > 0 && <span className="text-caution"> · {company.new} new</span>}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

function Funnel({ funnel }: { funnel: Record<JobStatus, number> }) {
  const tracked = FUNNEL_STEPS.reduce((sum, step) => sum + funnel[step], 0);
  const top = Math.max(1, ...FUNNEL_STEPS.map((step) => funnel[step]));

  return (
    <Section
      title="Application funnel"
      note="Jobs by the status you gave them (open or closed). Each job has one status."
    >
      {tracked === 0 && funnel.ignored === 0 ? (
        <p className="text-sm text-muted">
          Nothing tracked yet. Save or apply to a job on the Jobs page and it shows up here.
        </p>
      ) : (
        <ul className="space-y-2">
          {FUNNEL_STEPS.map((step) => (
            <li key={step}>
              <Link
                to={`/?status=${step}&tier=high,medium,low,none&india=all&includeClosed=true`}
                className="group grid grid-cols-[7rem_1fr_2.5rem] items-center gap-3 text-sm"
              >
                <span className="font-medium group-hover:text-accent group-hover:underline">
                  {STATUS_LABELS[step]}
                </span>
                <span className="h-4 overflow-hidden rounded-[2px] bg-sunken" aria-hidden="true">
                  <span
                    className={`block h-full ${step === "rejected" ? "bg-danger/60" : "bg-accent"}`}
                    style={{ width: `${sharePercent(funnel[step], top)}%` }}
                  />
                </span>
                <span className="text-right font-mono">{funnel[step]}</span>
              </Link>
            </li>
          ))}
          <li className="border-t border-line pt-2 text-sm text-muted">
            {funnel.ignored} ignored (hidden from the Jobs list by default)
          </li>
        </ul>
      )}
    </Section>
  );
}

function LastRun({ run }: { run: Stats["lastRun"] }) {
  if (!run) return "No refresh yet";
  const when = run.finishedAt ?? run.startedAt;
  return (
    <>
      Last refresh{" "}
      <time dateTime={when} title={formatAbsolute(when)}>
        {formatRelative(when)}
      </time>
      : {run.totals.ok} ok
      {run.totals.failed > 0 && (
        <span className="text-danger"> · {run.totals.failed} failed</span>
      )}{" "}
      · {run.totals.jobsNew} new · {run.totals.jobsClosed} closed
    </>
  );
}

export function DashboardPage() {
  const statsQuery = useStats();
  const stats = statsQuery.data;
  const hasJobs = stats ? TIERS.some((tier: RelevanceTier) => stats.tiers[tier] > 0) : false;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {stats ? <LastRun run={stats.lastRun} /> : "Loading…"}
        </p>
      </div>

      {statsQuery.isError ? (
        <ErrorState
          title="Could not load the dashboard"
          message={statsQuery.error.message}
          onRetry={() => void statsQuery.refetch()}
        />
      ) : !stats ? (
        <p role="status" className="text-sm text-muted">
          Loading the numbers…
        </p>
      ) : !hasJobs ? (
        <div className="border border-line bg-surface">
          <EmptyState title="No jobs yet">
            Run a refresh on the Jobs page. The dashboard fills in as companies are fetched.
          </EmptyState>
        </div>
      ) : (
        <>
          <TierStrip tiers={stats.tiers} />
          <NewPerDay days={stats.newPerDay} />
          <div className="grid gap-5 lg:grid-cols-2">
            <TopCompanies companies={stats.perCompany} />
            <Funnel funnel={stats.funnel} />
          </div>
        </>
      )}
    </div>
  );
}
