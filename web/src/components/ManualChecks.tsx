import type { CompanySummary } from "@server/types";
import { useId, useState } from "react";
import { buildBoardLinks } from "../lib/job-boards";
import { CATEGORY_LABELS } from "../lib/labels";
import { EmptyState } from "./StateViews";

interface JobBoardLinksProps {
  /** Keywords from the profile, best first. */
  keywords: readonly string[];
}

function JobBoardLinks({ keywords }: JobBoardLinksProps) {
  const selectId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const keyword = chosen ?? keywords[0] ?? "";
  const [copied, setCopied] = useState(false);

  const copyKeyword = async (): Promise<void> => {
    await navigator.clipboard.writeText(keyword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (keywords.length === 0) return null;
  return (
    <section aria-labelledby={`${selectId}-title`} className="border border-line bg-surface p-4">
      <h3 id={`${selectId}-title`} className="text-sm font-semibold">
        Job boards
      </h3>
      <p className="mt-0.5 text-sm text-muted">
        Search links for India. They open the board itself; nothing is fetched from it here.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label htmlFor={selectId} className="text-sm font-medium">
          Keyword
        </label>
        <select
          id={selectId}
          value={keyword}
          onChange={(event) => setChosen(event.target.value)}
          className="h-8 rounded-sm border border-line bg-surface px-2 text-sm"
        >
          {keywords.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ul className="flex flex-wrap gap-2">
          {buildBoardLinks(keyword).map((link) => (
            <li key={link.id}>
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer noopener"
                title={
                  link.prefilled
                    ? `Search ${link.name} for ${keyword}`
                    : `Open ${link.name} search; enter the keyword there`
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm font-medium hover:border-accent hover:text-accent"
              >
                {link.name}
                {!link.prefilled && (
                  <span className="text-xs font-normal text-muted">(search page)</span>
                )}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void copyKeyword()}
          className="h-8 rounded-sm px-2 text-sm text-accent underline-offset-2 hover:underline"
        >
          {copied ? "Copied" : "Copy keyword"}
        </button>
      </div>
    </section>
  );
}

interface ManualChecksProps {
  companies: CompanySummary[];
  /** True when the list is empty because of the filters, not because there are none. */
  filtered: boolean;
  keywords: readonly string[];
}

export function ManualChecks({ companies, filtered, keywords }: ManualChecksProps) {
  return (
    <section aria-labelledby="manual-heading" className="space-y-3">
      <div>
        <h2 id="manual-heading" className="text-base font-semibold">
          Check manually
        </h2>
        <p className="text-sm text-muted">
          These companies have no public job API we can read. Open their careers search yourself.
        </p>
      </div>

      <JobBoardLinks keywords={keywords} />

      <div className="border border-line bg-surface">
        {companies.length === 0 ? (
          <EmptyState
            title={filtered ? "No company matches these filters" : "Nothing to check by hand"}
          >
            {filtered ? "Clear the search or category to see the whole list." : undefined}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
              <caption className="sr-only">Companies to check by hand</caption>
              <thead className="border-b border-line bg-sunken/60 text-xs text-muted">
                <tr>
                  {["Company", "Category", "Why it needs a manual check", "Links"].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-3 py-2 font-medium whitespace-nowrap"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {companies.map(({ recipe }) => (
                  <tr key={recipe.slug} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      {recipe.name}
                    </th>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {CATEGORY_LABELS[recipe.category]}
                    </td>
                    <td className="max-w-[34rem] px-3 py-2 text-muted">{recipe.notes}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="flex gap-3">
                        {recipe.manualSearchUrl && (
                          <a
                            href={recipe.manualSearchUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium text-accent underline-offset-2 hover:underline"
                          >
                            Search jobs
                            <span className="sr-only"> at {recipe.name} (opens in a new tab)</span>
                          </a>
                        )}
                        <a
                          href={recipe.careersUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          Careers site
                          <span className="sr-only"> of {recipe.name} (opens in a new tab)</span>
                        </a>
                      </div>
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
