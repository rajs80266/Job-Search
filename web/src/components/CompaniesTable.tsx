import type { CompanySummary } from "@server/types";
import { formatAbsolute, formatRelative } from "../lib/format";
import { ATS_LABELS, CATEGORY_LABELS } from "../lib/labels";
import { type CompanyOutcome, canToggle, describeVerify } from "../lib/company-outcome";
import { RecipeStatusBadge } from "./Badges";
import { SpinnerIcon } from "./Icons";

const ACTION_BUTTON =
  "h-7 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium hover:border-muted disabled:cursor-not-allowed disabled:opacity-50";

function OutcomeLine({ outcome }: { outcome: CompanyOutcome | undefined }) {
  if (!outcome) return null;
  if (outcome.state === "running") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs text-accent-strong" role="status">
        <SpinnerIcon className="size-3.5" /> Checking the live endpoint…
      </p>
    );
  }
  if (outcome.state === "error") {
    return (
      <p className="mt-1 text-xs text-danger" role="alert">
        {outcome.message}
      </p>
    );
  }
  const { result } = outcome;
  return (
    <div className="mt-1 text-xs" role="status">
      <p className={result.ok ? "text-accent-strong" : "text-danger"}>
        {result.ok ? "Works: " : "Failed: "}
        {describeVerify(result)}
      </p>
      {result.ok && result.sampleTitles.length > 0 && (
        <p className="text-muted">e.g. {result.sampleTitles.join(" · ")}</p>
      )}
      {result.warnings.map((warning) => (
        <p key={warning} className="text-caution">
          {warning}
        </p>
      ))}
    </div>
  );
}

function ProblemLine({ summary }: { summary: CompanySummary }) {
  const { recipe, runtime } = summary;
  const problem = runtime.lastRefreshError ?? recipe.lastError;
  if (!problem || recipe.status === "disabled") return null;
  return (
    <p className="mt-0.5 line-clamp-2 text-xs text-danger" title={problem}>
      {runtime.lastRefreshError ? "Last refresh failed: " : "Last verify failed: "}
      {problem}
    </p>
  );
}

interface CompaniesTableProps {
  companies: CompanySummary[];
  outcomes: Record<string, CompanyOutcome>;
  busy: boolean;
  onVerify: (summary: CompanySummary) => void;
  onToggle: (summary: CompanySummary) => void;
}

export function CompaniesTable({
  companies,
  outcomes,
  busy,
  onVerify,
  onToggle,
}: CompaniesTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
        <caption className="sr-only">Companies and their job-fetching status</caption>
        <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
          <tr>
            {["Company", "Category", "ATS", "Status", "Last fetch", "Open jobs", "Actions"].map(
              (heading) => (
                <th key={heading} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {companies.map((summary) => {
            const { recipe, runtime } = summary;
            const verifying = outcomes[recipe.slug]?.state === "running";
            return (
              <tr
                key={recipe.slug}
                className={`border-b border-line align-top last:border-b-0 ${recipe.status === "disabled" ? "opacity-70" : ""}`}
              >
                <th scope="row" className="max-w-[22rem] px-3 py-2 text-left font-medium">
                  <a
                    href={recipe.careersUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:text-accent hover:underline"
                  >
                    {recipe.name}
                    <span className="sr-only"> careers site (opens in a new tab)</span>
                  </a>
                  <ProblemLine summary={summary} />
                  <OutcomeLine outcome={outcomes[recipe.slug]} />
                </th>
                <td className="px-3 py-2 whitespace-nowrap">{CATEGORY_LABELS[recipe.category]}</td>
                <td className="px-3 py-2 whitespace-nowrap text-muted">{ATS_LABELS[recipe.ats]}</td>
                <td className="px-3 py-2">
                  <RecipeStatusBadge status={recipe.status} />
                  {recipe.verifiedOn && recipe.status !== "unverified" && (
                    <p className="mt-0.5 text-xs text-muted" title="Last successful verify">
                      verified {recipe.verifiedOn}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {runtime.lastSuccessAt ? (
                    <time
                      dateTime={runtime.lastSuccessAt}
                      title={formatAbsolute(runtime.lastSuccessAt)}
                      className="font-mono text-xs"
                    >
                      {formatRelative(runtime.lastSuccessAt)}
                    </time>
                  ) : (
                    <span className="text-muted" title="Never fetched">
                      —
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                  {runtime.openJobs}
                  {runtime.newJobs > 0 && (
                    <span className="ml-1.5 font-semibold text-caution">
                      +{runtime.newJobs} new
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className={ACTION_BUTTON}
                      disabled={verifying || recipe.status === "disabled"}
                      onClick={() => onVerify(summary)}
                      title={
                        recipe.status === "disabled"
                          ? "Enable the company first"
                          : "Call the live endpoint once and check that jobs come back"
                      }
                      aria-label={`Verify ${recipe.name} now`}
                    >
                      {verifying ? "Verifying…" : "Verify now"}
                    </button>
                    {canToggle(summary) && (
                      <button
                        type="button"
                        className={ACTION_BUTTON}
                        disabled={busy || verifying}
                        onClick={() => onToggle(summary)}
                        title={
                          recipe.status === "disabled"
                            ? "Turn on again; it is verified once before it is refreshed"
                            : "Stop refreshing this company"
                        }
                        aria-label={`${recipe.status === "disabled" ? "Enable" : "Disable"} ${recipe.name}`}
                      >
                        {recipe.status === "disabled" ? "Enable" : "Disable"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
