import { PAGE_SIZES } from "../lib/job-filters";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}

const BUTTON =
  "h-8 rounded-sm border border-line bg-surface px-3 text-sm font-medium hover:border-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line";

export function Pagination({ page, pageSize, total, onPage, onPageSize }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <p aria-live="polite" className="text-muted">
        Showing{" "}
        <span className="font-mono text-ink">
          {first}–{last}
        </span>{" "}
        of <span className="font-mono text-ink">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-muted">
          Rows
          <select
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
            className="h-8 rounded-sm border border-line bg-surface px-1.5 text-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={BUTTON}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <span className="text-muted">
          Page <span className="font-mono text-ink">{page}</span> of{" "}
          <span className="font-mono text-ink">{pageCount}</span>
        </span>
        <button
          type="button"
          className={BUTTON}
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
