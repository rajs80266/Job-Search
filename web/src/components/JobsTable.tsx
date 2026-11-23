import type { JobListItem, JobStatus } from "@server/types";
import type { ReactNode } from "react";
import { formatAbsolute, formatRelative } from "../lib/format";
import type { JobSort } from "../lib/job-filters";
import { CATEGORY_LABELS } from "../lib/labels";
import { KeywordChips, NewPill, StatusChip, TierBadge } from "./Badges";
import {
  ArrowDownIcon,
  BookmarkIcon,
  CheckCircleIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  NoteIcon,
} from "./Icons";

const MAX_CITIES_SHOWN = 2;

function SortableHeader({
  label,
  sort,
  activeSort,
  onSort,
}: {
  label: string;
  sort: JobSort;
  activeSort: JobSort;
  onSort: (sort: JobSort) => void;
}) {
  const active = sort === activeSort;
  return (
    <th
      scope="col"
      aria-sort={active ? "descending" : undefined}
      className="px-3 py-2 font-medium whitespace-nowrap"
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        title={active ? `Sorted by ${label}` : `Sort by ${label}`}
        className={`inline-flex items-center gap-1 rounded-sm font-medium ${active ? "text-ink" : "text-muted hover:text-ink"}`}
      >
        {label}
        {active && <ArrowDownIcon className="size-3.5" />}
      </button>
    </th>
  );
}

function RelativeTime({ iso, emptyTitle }: { iso: string | null; emptyTitle: string }) {
  if (!iso) {
    return (
      <span className="text-muted" title={emptyTitle}>
        —
      </span>
    );
  }
  return (
    <time
      dateTime={iso}
      title={formatAbsolute(iso)}
      className="font-mono text-xs whitespace-nowrap"
    >
      {formatRelative(iso)}
    </time>
  );
}

function CityCell({ job }: { job: JobListItem }) {
  if (job.cities.length === 0) {
    return job.locationRaw ? (
      <span className="line-clamp-2 text-muted" title={job.locationRaw}>
        {job.locationRaw}
      </span>
    ) : (
      <span className="text-muted" title="The listing gives no location">
        —
      </span>
    );
  }
  const shown = job.cities.slice(0, MAX_CITIES_SHOWN).join(", ");
  const extra = job.cities.length - MAX_CITIES_SHOWN;
  return (
    <span title={job.locationRaw || job.cities.join(", ")}>
      {shown}
      {extra > 0 && <span className="text-muted"> +{extra}</span>}
    </span>
  );
}

const ICON_BUTTON =
  "relative inline-flex size-7 items-center justify-center rounded-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:bg-accent-soft aria-pressed:text-accent-strong";

function ToggleAction({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={ICON_BUTTON}
    >
      {children}
    </button>
  );
}

interface RowProps {
  job: JobListItem;
  onToggleStatus: (job: JobListItem, status: JobStatus) => void;
  onOpenNotes: (job: JobListItem) => void;
}

function JobRow({ job, onToggleStatus, onOpenNotes }: RowProps) {
  const label = `${job.title} at ${job.companyName}`;
  const isClosed = job.closedAt !== null;
  return (
    <tr
      className={`border-b border-line align-top last:border-b-0 hover:bg-accent-soft/30 ${
        job.status === "ignored" || isClosed ? "opacity-60" : ""
      }`}
    >
      <td
        className={`px-3 py-2 whitespace-nowrap ${job.isNew ? "shadow-[inset_3px_0_0_var(--color-caution)]" : ""}`}
      >
        <TierBadge tier={job.relevanceTier} score={job.relevanceScore} />
      </td>
      <td className="max-w-[26rem] px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer noopener"
            className="line-clamp-2 font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
            title={job.title}
          >
            {job.title}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          {job.isNew && <NewPill />}
          {job.closedAt && (
            <span
              className="rounded-sm bg-sunken px-1 py-px text-[0.6875rem] font-semibold tracking-wide text-muted uppercase"
              title={`Closed ${formatAbsolute(job.closedAt)}`}
            >
              Closed
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{job.companyName}</div>
        <div className="text-xs text-muted">{CATEGORY_LABELS[job.category]}</div>
      </td>
      <td className="max-w-[12rem] px-3 py-2">
        <CityCell job={job} />
      </td>
      <td className="max-w-[16rem] px-3 py-2">
        <KeywordChips keywords={job.matchedKeywords} />
      </td>
      <td className="px-3 py-2">
        <RelativeTime iso={job.postedAt} emptyTitle="This company's listing gives no posted date" />
      </td>
      <td className="px-3 py-2">
        <RelativeTime iso={job.firstSeenAt} emptyTitle="" />
      </td>
      <td className="px-3 py-2">
        <StatusChip status={job.status} />
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        <div className="flex items-center gap-0.5" role="group" aria-label={`Actions for ${label}`}>
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${label} in a new tab`}
            title="Open posting"
            className={ICON_BUTTON}
          >
            <ExternalLinkIcon />
          </a>
          <ToggleAction
            label={`Save ${label}`}
            pressed={job.status === "saved"}
            onClick={() => onToggleStatus(job, "saved")}
          >
            <BookmarkIcon />
          </ToggleAction>
          <ToggleAction
            label={`Mark ${label} as applied`}
            pressed={job.status === "applied"}
            onClick={() => onToggleStatus(job, "applied")}
          >
            <CheckCircleIcon />
          </ToggleAction>
          <ToggleAction
            label={`Ignore ${label}`}
            pressed={job.status === "ignored"}
            onClick={() => onToggleStatus(job, "ignored")}
          >
            <EyeOffIcon />
          </ToggleAction>
          <button
            type="button"
            aria-label={`Notes for ${label}${job.notes ? " (has notes)" : ""}`}
            title={job.notes ? "Edit notes" : "Add notes"}
            onClick={() => onOpenNotes(job)}
            className={ICON_BUTTON}
          >
            <NoteIcon />
            {job.notes && (
              <span
                className="absolute top-1 right-1 size-1.5 rounded-full bg-caution"
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

interface JobsTableProps {
  jobs: JobListItem[];
  sort: JobSort;
  onSort: (sort: JobSort) => void;
  onToggleStatus: (job: JobListItem, status: JobStatus) => void;
  onOpenNotes: (job: JobListItem) => void;
  /** True while a new page or filter is loading over the old rows. */
  busy: boolean;
}

export function JobsTable({
  jobs,
  sort,
  onSort,
  onToggleStatus,
  onOpenNotes,
  busy,
}: JobsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-busy={busy}
        className={`w-full min-w-[68rem] border-collapse text-left text-sm transition-opacity ${busy ? "opacity-60" : ""}`}
      >
        <caption className="sr-only">Job openings ranked for your profile</caption>
        <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
          <tr>
            <SortableHeader label="Tier" sort="relevance" activeSort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              Title
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              Company
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              City
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              Matches
            </th>
            <SortableHeader label="Posted" sort="posted" activeSort={sort} onSort={onSort} />
            <SortableHeader label="First seen" sort="firstSeen" activeSort={sort} onSort={onSort} />
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              Status
            </th>
            <th scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onToggleStatus={onToggleStatus}
              onOpenNotes={onOpenNotes}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JobsTableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading jobs" role="status" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-3 py-3">
          <div className="h-5 w-20 animate-pulse rounded-sm bg-sunken" />
          <div className="h-4 flex-1 animate-pulse rounded-sm bg-sunken" />
          <div className="h-4 w-32 animate-pulse rounded-sm bg-sunken" />
          <div className="h-4 w-24 animate-pulse rounded-sm bg-sunken" />
        </div>
      ))}
    </div>
  );
}
