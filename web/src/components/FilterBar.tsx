import type { CompanyCategory, RelevanceTier } from "@server/types";
import { useEffect, useRef, useState } from "react";
import type { IndiaFilter, JobFilters, StatusFilter } from "../lib/job-filters";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  JOB_STATUS_VALUES,
  STATUS_LABELS,
  TIERS,
  TIER_LABELS,
} from "../lib/labels";
import { SearchIcon } from "./Icons";
import { MultiSelect, type Option } from "./MultiSelect";

const SEARCH_DEBOUNCE_MS = 300;

interface FilterBarProps {
  filters: JobFilters;
  onChange: (patch: Partial<JobFilters>) => void;
  onClear: () => void;
  canClear: boolean;
  companyOptions: readonly Option[];
  preferredCities: readonly string[];
  otherCities: readonly string[];
}

const SELECT_CLASS = "h-8 rounded-sm border border-line bg-surface px-2 text-sm hover:border-muted";

/**
 * Typing is debounced into the URL. When the URL changes for any other reason (clear filters,
 * back button) the box follows it.
 */
function SearchBox({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  const [draft, setDraft] = useState(query);
  const [committed, setCommitted] = useState(query);
  const [seenQuery, setSeenQuery] = useState(query);
  const timer = useRef<number | undefined>(undefined);

  if (query !== seenQuery) {
    setSeenQuery(query);
    if (query !== committed) {
      setDraft(query);
      setCommitted(query);
    }
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commit = (value: string): void => {
    window.clearTimeout(timer.current);
    setCommitted(value.trim());
    onSearch(value.trim());
  };

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        commit(draft);
      }}
      className="relative"
    >
      <SearchIcon className="pointer-events-none absolute top-2 left-2 text-muted" />
      <input
        type="search"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(event.target.value), SEARCH_DEBOUNCE_MS);
        }}
        placeholder="Search title, company, location…"
        aria-label="Search jobs"
        className="h-8 w-80 rounded-sm border border-line bg-surface pr-2 pl-8 text-sm placeholder:text-muted hover:border-muted"
      />
    </form>
  );
}

function ToggleButton({
  pressed,
  onClick,
  children,
  title,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      title={title}
      className={`h-8 rounded-sm border px-2.5 text-sm font-medium ${
        pressed
          ? "border-accent bg-accent text-white"
          : "border-line bg-surface text-ink hover:border-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  filters,
  onChange,
  onClear,
  canClear,
  companyOptions,
  preferredCities,
  otherCities,
}: FilterBarProps) {
  const toggleTier = (tier: RelevanceTier): void => {
    const next = filters.tier.includes(tier)
      ? filters.tier.filter((t) => t !== tier)
      : [...filters.tier, tier];
    if (next.length > 0) onChange({ tier: TIERS.filter((t) => next.includes(t)) });
  };

  return (
    <section aria-label="Filters" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox query={filters.q} onSearch={(q) => onChange({ q })} />
        <div role="group" aria-label="Relevance tier" className="flex gap-1">
          {TIERS.map((tier) => (
            <ToggleButton
              key={tier}
              pressed={filters.tier.includes(tier)}
              onClick={() => toggleTier(tier)}
            >
              {TIER_LABELS[tier]}
            </ToggleButton>
          ))}
        </div>
        <ToggleButton
          pressed={filters.isNew}
          onClick={() => onChange({ isNew: !filters.isNew })}
          title="Jobs that first appeared in their company's latest successful fetch. A company's first fetch is a baseline and marks nothing as new."
        >
          New
        </ToggleButton>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          label="Company"
          searchable
          options={companyOptions}
          selected={filters.company}
          onChange={(company) => onChange({ company })}
          emptyMessage="No company has been fetched yet"
        />
        <MultiSelect
          label="Category"
          options={CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
          selected={filters.category}
          onChange={(category) => onChange({ category: category as CompanyCategory[] })}
        />
        <select
          aria-label="City"
          value={filters.city}
          onChange={(event) => onChange({ city: event.target.value })}
          className={SELECT_CLASS}
        >
          <option value="">Any city</option>
          {preferredCities.length > 0 && (
            <optgroup label="Preferred">
              {preferredCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Other cities">
            {otherCities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          aria-label="Application status"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
          className={SELECT_CLASS}
        >
          <option value="">Any status (hide ignored)</option>
          <option value="none">No status yet</option>
          {JOB_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          aria-label="Location scope"
          value={filters.india}
          onChange={(event) => onChange({ india: event.target.value as IndiaFilter })}
          className={SELECT_CLASS}
        >
          <option value="true">India</option>
          <option value="false">Outside India</option>
          <option value="all">All locations</option>
        </select>
        <label className="flex h-8 items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={filters.remote}
            onChange={(event) => onChange({ remote: event.target.checked })}
            className="accent-accent"
          />
          Remote only
        </label>
        <label className="flex h-8 items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={filters.includeClosed}
            onChange={(event) => onChange({ includeClosed: event.target.checked })}
            className="accent-accent"
          />
          Include closed
        </label>
        {canClear && (
          <button
            type="button"
            onClick={onClear}
            className="h-8 rounded-sm px-2 text-sm font-medium text-accent underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}
