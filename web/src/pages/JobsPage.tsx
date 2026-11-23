import type { JobListItem, JobStatus } from "@server/types";
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCompanies, useJobs, useProfile, useUpdateJobStatus } from "../api/hooks";
import { useRefreshController } from "../api/refresh-controller";
import { FilterBar } from "../components/FilterBar";
import { JobsTable, JobsTableSkeleton } from "../components/JobsTable";
import { NotesDrawer } from "../components/NotesDrawer";
import { Pagination } from "../components/Pagination";
import { RefreshControls, RefreshPanel } from "../components/RefreshPanel";
import { EmptyState, ErrorState } from "../components/StateViews";
import { Toast, type ToastMessage } from "../components/Toast";
import {
  hasActiveFilters,
  parseFilters,
  toSearchParams,
  type JobFilters,
} from "../lib/job-filters";
import { STATUS_LABELS } from "../lib/labels";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function JobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const jobsQuery = useJobs(filters);
  const companiesQuery = useCompanies();
  const profileQuery = useProfile();
  const updateStatus = useUpdateJobStatus();

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [drawerJob, setDrawerJob] = useState<JobListItem | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const refresh = useRefreshController(companiesQuery.data);

  const companyOptions = useMemo(
    () =>
      (companiesQuery.data?.companies ?? [])
        .filter((company) => company.runtime.lastSuccessAt !== null)
        .map((company) => ({ value: company.recipe.slug, label: company.recipe.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [companiesQuery.data],
  );
  const { preferredCities, otherCities } = useMemo(() => {
    const profile = profileQuery.data;
    if (!profile) return { preferredCities: [], otherCities: [] };
    const preferred = profile.candidate.preferredCities;
    const all = [...profile.cities.map((city) => city.name), "Remote"];
    return {
      preferredCities: preferred,
      otherCities: [...new Set(all)].filter((city) => !preferred.includes(city)).sort(),
    };
  }, [profileQuery.data]);

  const updateFilters = (patch: Partial<JobFilters>): void => {
    const resetsPage = !("page" in patch);
    setSearchParams(toSearchParams({ ...filters, ...patch, ...(resetsPage && { page: 1 }) }), {
      replace: true,
    });
  };

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const showToast = (text: string, undo?: () => void): void =>
    setToast({ id: Date.now(), text, undo });

  const setJobStatus = (job: JobListItem, status: JobStatus | null): void => {
    const previous = job.status;
    updateStatus.mutate(
      { jobId: job.id, update: { status } },
      {
        onSuccess: () => {
          const undo = () => updateStatus.mutate({ jobId: job.id, update: { status: previous } });
          const change = status
            ? `marked ${STATUS_LABELS[status].toLowerCase()}`
            : "status cleared";
          showToast(`${job.title}: ${change}`, undo);
        },
        onError: (error) => showToast(`Could not update the status: ${errorMessage(error)}`),
      },
    );
  };

  const toggleStatus = (job: JobListItem, status: JobStatus): void =>
    setJobStatus(job, job.status === status ? null : status);

  const saveNotes = (job: JobListItem, notes: string): void =>
    updateStatus.mutate(
      { jobId: job.id, update: { notes } },
      { onError: (error) => showToast(`Could not save the notes: ${errorMessage(error)}`) },
    );

  const page = jobsQuery.data;
  const drawerLive = drawerJob && (page?.items.find((job) => job.id === drawerJob.id) ?? drawerJob);
  const noCompanyFetchedYet =
    companiesQuery.isSuccess &&
    companiesQuery.data.companies.every((c) => !c.runtime.lastSuccessAt);
  const filtered = hasActiveFilters(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {page
              ? `${page.total} ${page.total === 1 ? "job" : "jobs"} match${page.total === 1 ? "es" : ""}`
              : jobsQuery.isError
                ? "Not available"
                : "Loading…"}
          </p>
        </div>
        <RefreshControls
          latestRun={refresh.latestRun}
          running={refresh.running}
          starting={refresh.starting}
          fullRefresh={refresh.fullRefresh}
          onFullRefreshChange={refresh.setFullRefresh}
          onStart={refresh.start}
          panelOpen={refresh.panelOpen}
          onTogglePanel={refresh.togglePanel}
          startError={refresh.startError}
        />
      </div>

      {refresh.panelOpen && (
        <RefreshPanel
          progress={refresh.progress}
          plannedSlugs={refresh.plannedSlugs}
          companyNames={refresh.companyNames}
          onClose={refresh.closePanel}
        />
      )}

      {companiesQuery.data && companiesQuery.data.invalidFiles.length > 0 && (
        <p role="status" className="rounded-sm bg-caution-soft px-3 py-2 text-sm text-caution">
          {companiesQuery.data.invalidFiles.length} recipe file(s) are invalid and skipped:{" "}
          {companiesQuery.data.invalidFiles.map((file) => file.file).join(", ")}
        </p>
      )}

      <FilterBar
        filters={filters}
        onChange={updateFilters}
        onClear={clearFilters}
        canClear={filtered}
        companyOptions={companyOptions}
        preferredCities={preferredCities}
        otherCities={otherCities}
      />

      <div className="border border-line bg-surface">
        {jobsQuery.isPending ? (
          <JobsTableSkeleton />
        ) : jobsQuery.isError ? (
          <div className="p-4">
            <ErrorState
              title="Could not load jobs"
              message={errorMessage(jobsQuery.error)}
              onRetry={() => void jobsQuery.refetch()}
            />
          </div>
        ) : page && page.items.length === 0 ? (
          <EmptyJobs
            filtered={filtered}
            isNewOnly={filters.isNew}
            noCompanyFetchedYet={noCompanyFetchedYet}
            onClear={clearFilters}
          />
        ) : (
          page && (
            <JobsTable
              jobs={page.items}
              sort={filters.sort}
              onSort={(sort) => updateFilters({ sort })}
              onToggleStatus={toggleStatus}
              onOpenNotes={setDrawerJob}
              busy={jobsQuery.isPlaceholderData}
            />
          )
        )}
      </div>

      {page && page.total > 0 && (
        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={page.total}
          onPage={(nextPage) => updateFilters({ page: nextPage })}
          onPageSize={(pageSize) => updateFilters({ pageSize })}
        />
      )}

      <NotesDrawer
        job={drawerLive}
        saving={updateStatus.isPending}
        onClose={() => setDrawerJob(null)}
        onChangeStatus={setJobStatus}
        onSaveNotes={saveNotes}
      />
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}

function EmptyJobs({
  filtered,
  isNewOnly,
  noCompanyFetchedYet,
  onClear,
}: {
  filtered: boolean;
  isNewOnly: boolean;
  noCompanyFetchedYet: boolean;
  onClear: () => void;
}) {
  if (noCompanyFetchedYet && !filtered) {
    return (
      <EmptyState title="No jobs yet">
        Press Refresh to fetch the first jobs. The first fetch for each company is a baseline, so
        nothing is marked New until the next refresh.
      </EmptyState>
    );
  }
  if (isNewOnly) {
    return (
      <EmptyState
        title="Nothing new since the last refresh"
        action={<ClearButton onClear={onClear} label="Show all jobs" />}
      >
        New means the job first appeared in its company's latest successful fetch.
      </EmptyState>
    );
  }
  if (filtered) {
    return (
      <EmptyState
        title="No jobs match these filters"
        action={<ClearButton onClear={onClear} label="Clear filters" />}
      >
        The default view hides jobs with no relevance (tier None) and ones you ignored.
      </EmptyState>
    );
  }
  return (
    <EmptyState title="No open India jobs">
      Every fetched job is closed, outside India or ignored. Try the Location filter.
    </EmptyState>
  );
}

function ClearButton({ onClear, label }: { onClear: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="h-8 rounded-sm border border-line bg-surface px-3 text-sm font-medium hover:border-muted"
    >
      {label}
    </button>
  );
}
