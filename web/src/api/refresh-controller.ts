import { useQueryClient } from "@tanstack/react-query";
import type { CompanyList } from "@server/types";
import { useCallback, useMemo, useState } from "react";
import { REFRESHABLE_STATUSES } from "../lib/labels";
import { ApiError } from "./client";
import { useRefreshRun } from "./events";
import { LATEST_RUN_KEY, refreshAfterRun, useLatestRun, useStartRefresh } from "./hooks";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** The run id a 409 "already running" answer points at, if the error is one. */
function alreadyRunningId(error: unknown): number | undefined {
  if (!(error instanceof ApiError) || error.status !== 409) return undefined;
  return (error.details as { runId?: number } | undefined)?.runId;
}

/**
 * Starts refresh runs and follows one over SSE. The panel opens by itself while a run is going
 * (also after a page reload) and stays under the user's control otherwise.
 */
export function useRefreshController(companies: CompanyList | undefined) {
  const queryClient = useQueryClient();
  const latestRunQuery = useLatestRun();
  const startMutation = useStartRefresh();

  const [fullRefresh, setFullRefresh] = useState(false);
  const [followedRunId, setFollowedRunId] = useState<number | null>(null);
  /** null = follow the run state (open while running). */
  const [panelOverride, setPanelOverride] = useState<boolean | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const latestRun = latestRunQuery.data;
  const runIsLive = latestRun?.status === "running";
  const panelOpen = panelOverride ?? runIsLive;
  // Keep listening while a run is going even if the panel is hidden, so the job list updates when it ends.
  const streamedRunId = panelOpen || runIsLive ? (followedRunId ?? latestRun?.id ?? null) : null;

  const progress = useRefreshRun(
    streamedRunId,
    useCallback(() => void refreshAfterRun(queryClient), [queryClient]),
  );

  const companyNames = useMemo(
    () =>
      new Map(companies?.companies.map((company) => [company.recipe.slug, company.recipe.name])),
    [companies],
  );
  const singleCompanyRun = progress.run?.companySlug ?? null;
  const plannedSlugs = useMemo(() => {
    if (singleCompanyRun) return [singleCompanyRun];
    return (
      companies?.companies
        .filter((company) => REFRESHABLE_STATUSES.includes(company.recipe.status))
        .map((company) => company.recipe.slug) ?? []
    );
  }, [companies, singleCompanyRun]);

  const follow = (runId: number): void => {
    setFollowedRunId(runId);
    setPanelOverride(true);
    void queryClient.invalidateQueries({ queryKey: LATEST_RUN_KEY });
  };

  const start = (): void => {
    setStartError(null);
    startMutation.mutate(
      { full: fullRefresh },
      {
        onSuccess: ({ runId }) => follow(runId),
        onError: (error) => {
          const activeRunId = alreadyRunningId(error);
          if (activeRunId !== undefined) follow(activeRunId);
          else setStartError(errorMessage(error));
        },
      },
    );
  };

  return {
    latestRun,
    running: runIsLive || startMutation.isPending,
    starting: startMutation.isPending,
    fullRefresh,
    setFullRefresh,
    start,
    panelOpen,
    togglePanel: () => setPanelOverride(!panelOpen),
    closePanel: () => setPanelOverride(false),
    startError,
    progress,
    plannedSlugs,
    companyNames,
  };
}
