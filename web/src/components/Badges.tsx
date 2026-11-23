import type { JobStatus, RecipeStatus, RelevanceTier } from "@server/types";
import { RECIPE_STATUS_LABELS, STATUS_LABELS, TIER_LABELS } from "../lib/labels";

const TIER_STYLES: Record<RelevanceTier, string> = {
  high: "bg-accent text-white",
  medium: "bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/30",
  low: "bg-sunken text-ink ring-1 ring-inset ring-line",
  none: "bg-transparent text-muted ring-1 ring-inset ring-line",
};

export function TierBadge({ tier, score }: { tier: RelevanceTier; score: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block min-w-[4.25rem] rounded-sm px-1.5 py-0.5 text-center text-xs font-semibold ${TIER_STYLES[tier]}`}
      >
        {TIER_LABELS[tier]}
      </span>
      <span className="font-mono text-xs text-muted" title={`Relevance score ${score}`}>
        {score}
      </span>
    </span>
  );
}

const STATUS_STYLES: Record<JobStatus, string> = {
  saved: "bg-caution-soft text-caution",
  applied: "bg-accent-soft text-accent-strong",
  interviewing: "bg-accent text-white",
  rejected: "bg-danger-soft text-danger",
  ignored: "bg-sunken text-muted",
};

export function StatusChip({ status }: { status: JobStatus | null }) {
  if (!status) return <span className="text-muted">—</span>;
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function NewPill() {
  return (
    <span className="rounded-sm bg-caution-soft px-1 py-px text-[0.6875rem] font-semibold tracking-wide text-caution uppercase">
      New
    </span>
  );
}

export function KeywordChips({ keywords, limit = 3 }: { keywords: string[]; limit?: number }) {
  if (keywords.length === 0) return <span className="text-muted">—</span>;
  const shown = keywords.slice(0, limit);
  const hidden = keywords.slice(limit);
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Matched keywords">
      {shown.map((keyword) => (
        <li
          key={keyword}
          className="rounded-sm bg-sunken px-1.5 py-px text-xs whitespace-nowrap text-ink"
        >
          {keyword}
        </li>
      ))}
      {hidden.length > 0 && (
        <li
          className="rounded-sm px-1 py-px text-xs text-muted"
          title={hidden.join(", ")}
          aria-label={`and ${hidden.length} more: ${hidden.join(", ")}`}
        >
          +{hidden.length}
        </li>
      )}
    </ul>
  );
}

const RECIPE_STATUS_STYLES: Record<RecipeStatus, string> = {
  verified: "bg-accent-soft text-accent-strong",
  unverified: "bg-caution-soft text-caution",
  broken: "bg-danger-soft text-danger",
  disabled: "bg-sunken text-muted",
  "needs-manual": "bg-sunken text-ink",
};

export function RecipeStatusBadge({ status }: { status: RecipeStatus }) {
  return (
    <span
      className={`rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${RECIPE_STATUS_STYLES[status]}`}
    >
      {RECIPE_STATUS_LABELS[status]}
    </span>
  );
}
