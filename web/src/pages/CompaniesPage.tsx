import type { CompanyCategory, CompanySummary, RecipeStatus } from "@server/types";
import { useCallback, useState } from "react";
import { useCompanyActions } from "../api/company-actions";
import { useCompanies, useProfile } from "../api/hooks";
import { AddCompanyDialog } from "../components/AddCompanyDialog";
import { CompaniesTable } from "../components/CompaniesTable";
import { ManualChecks } from "../components/ManualChecks";
import { EmptyState, ErrorState } from "../components/StateViews";
import { Toast, type ToastMessage } from "../components/Toast";
import { CATEGORIES, CATEGORY_LABELS, RECIPE_STATUS_LABELS } from "../lib/labels";

const LISTED_STATUSES: readonly RecipeStatus[] = ["verified", "unverified", "broken", "disabled"];

function matches(summary: CompanySummary, search: string, category: string): boolean {
  const { recipe } = summary;
  const text = `${recipe.name} ${recipe.slug}`.toLowerCase();
  return text.includes(search.trim().toLowerCase()) && (!category || recipe.category === category);
}

function countByStatus(companies: CompanySummary[]): string {
  const counts = new Map<RecipeStatus, number>();
  for (const { recipe } of companies)
    counts.set(recipe.status, (counts.get(recipe.status) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} ${RECIPE_STATUS_LABELS[status].toLowerCase()}`)
    .join(" · ");
}

export function CompaniesPage() {
  const companiesQuery = useCompanies();
  const profileQuery = useProfile();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);
  const notify = (text: string): void => setToast({ id: Date.now(), text });
  const actions = useCompanyActions(notify);

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CompanyCategory | "">("");
  const [status, setStatus] = useState<RecipeStatus | "">("");

  const all = companiesQuery.data?.companies ?? [];
  const manual = all.filter(({ recipe }) => recipe.status === "needs-manual");
  const fetchable = all.filter(({ recipe }) => recipe.status !== "needs-manual");
  const shown = fetchable.filter(
    (summary) =>
      matches(summary, search, category) && (!status || summary.recipe.status === status),
  );
  const shownManual = manual.filter((summary) => matches(summary, search, category));
  const keywords = profileQuery.data?.keywords.core.map((concept) => concept.term) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {companiesQuery.data
              ? `${countByStatus(fetchable)}${manual.length > 0 ? ` · ${manual.length} to check manually` : ""}`
              : "Loading…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-9 items-center rounded-sm bg-accent px-3.5 text-sm font-semibold text-white hover:bg-accent-strong"
        >
          Add company
        </button>
      </div>

      {companiesQuery.data && companiesQuery.data.invalidFiles.length > 0 && (
        <p role="status" className="rounded-sm bg-caution-soft px-3 py-2 text-sm text-caution">
          {companiesQuery.data.invalidFiles.length} recipe file(s) are invalid and skipped:{" "}
          {companiesQuery.data.invalidFiles.map((file) => file.file).join(", ")}
        </p>
      )}

      <section aria-label="Filters" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search companies…"
          aria-label="Search companies"
          className="h-8 w-64 rounded-sm border border-line bg-surface px-2 text-sm placeholder:text-muted"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(event) => setCategory(event.target.value as CompanyCategory | "")}
          className="h-8 rounded-sm border border-line bg-surface px-2 text-sm"
        >
          <option value="">Any category</option>
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {CATEGORY_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          aria-label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as RecipeStatus | "")}
          className="h-8 rounded-sm border border-line bg-surface px-2 text-sm"
        >
          <option value="">Any status</option>
          {LISTED_STATUSES.map((value) => (
            <option key={value} value={value}>
              {RECIPE_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </section>

      <section aria-label="Companies with a job feed" className="border border-line bg-surface">
        {companiesQuery.isPending ? (
          <p role="status" className="p-6 text-sm text-muted">
            Loading companies…
          </p>
        ) : companiesQuery.isError ? (
          <div className="p-4">
            <ErrorState
              title="Could not load companies"
              message={companiesQuery.error.message}
              onRetry={() => void companiesQuery.refetch()}
            />
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title={fetchable.length === 0 ? "No companies yet" : "No company matches these filters"}
          >
            {fetchable.length === 0
              ? "Add a company by pasting the request its careers page uses to load jobs."
              : "Clear the search, category or status to see the whole list."}
          </EmptyState>
        ) : (
          <CompaniesTable
            companies={shown}
            outcomes={actions.outcomes}
            busy={actions.isSaving}
            onVerify={(summary) => void actions.verifyNow(summary.recipe.slug, summary.recipe.name)}
            onToggle={(summary) => void actions.toggleEnabled(summary)}
          />
        )}
      </section>

      {companiesQuery.isSuccess && (
        <ManualChecks
          companies={shownManual}
          filtered={manual.length > 0 && shownManual.length === 0}
          keywords={keywords}
        />
      )}

      <AddCompanyDialog
        open={adding}
        existingSlugs={new Set(all.map(({ recipe }) => recipe.slug))}
        onClose={() => setAdding(false)}
        onSaved={(message) => {
          setAdding(false);
          notify(message);
        }}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
