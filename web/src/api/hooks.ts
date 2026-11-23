import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CompanyList,
  CompanyRecipe,
  CompanySummary,
  ImportCurlResponse,
  JobListItem,
  JobStatusRecord,
  JobStatusUpdate,
  Page,
  Profile,
  RefreshRequest,
  RefreshRunSummary,
  ProfileSaveResponse,
  RefreshStarted,
  Stats,
  VerifyResult,
} from "@server/types";
import { toApiQuery, type JobFilters } from "../lib/job-filters";
import { apiGet, apiSend } from "./client";

const JOBS_KEY = ["jobs"] as const;
export const LATEST_RUN_KEY = ["refresh", "latest"] as const;

export function useJobs(filters: JobFilters) {
  return useQuery({
    queryKey: [...JOBS_KEY, toApiQuery(filters)],
    queryFn: () => apiGet<Page<JobListItem>>(`/api/jobs?${toApiQuery(filters)}`),
    placeholderData: keepPreviousData,
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: ["companies"],
    queryFn: () => apiGet<CompanyList>("/api/companies"),
    staleTime: 60_000,
  });
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: () => apiGet<Profile>("/api/profile"),
    staleTime: 5 * 60_000,
  });
}

export function useLatestRun() {
  return useQuery({
    queryKey: LATEST_RUN_KEY,
    queryFn: () => apiGet<RefreshRunSummary | null>("/api/refresh/latest"),
  });
}

export function useStartRefresh() {
  return useMutation({
    mutationFn: (request: RefreshRequest) =>
      apiSend<RefreshStarted>("POST", "/api/refresh", request),
  });
}

/** Call when a run ends: new jobs, closed jobs and company counts all changed. */
export function refreshAfterRun(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
    queryClient.invalidateQueries({ queryKey: ["companies"] }),
    queryClient.invalidateQueries({ queryKey: LATEST_RUN_KEY }),
  ]).then(() => undefined);
}

function applyUpdate(job: JobListItem, update: JobStatusUpdate): JobListItem {
  return {
    ...job,
    status: update.status === undefined ? job.status : update.status,
    notes: update.notes ?? job.notes,
  };
}

interface StatusMutation {
  jobId: string;
  update: JobStatusUpdate;
}

/** Updates the cached rows immediately and rolls back if the server rejects the change. */
export function useUpdateJobStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ jobId, update }: StatusMutation) =>
      apiSend<JobStatusRecord>("PATCH", `/api/jobs/${jobId}/status`, update),
    onMutate: async ({ jobId, update }) => {
      await queryClient.cancelQueries({ queryKey: JOBS_KEY });
      const previous = queryClient.getQueriesData<Page<JobListItem>>({ queryKey: JOBS_KEY });
      queryClient.setQueriesData<Page<JobListItem>>(
        { queryKey: JOBS_KEY },
        (page) =>
          page && {
            ...page,
            items: page.items.map((job) => (job.id === jobId ? applyUpdate(job, update) : job)),
          },
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      for (const [key, page] of context?.previous ?? []) queryClient.setQueryData(key, page);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
  });
}

const COMPANIES_KEY = ["companies"] as const;

export function useImportCurl() {
  return useMutation({
    mutationFn: (request: { text: string }) =>
      apiSend<ImportCurlResponse>("POST", "/api/companies/import-curl", request),
  });
}

/** Without a recipe: verifies the stored company and saves the outcome. With one: a dry run. */
export function useVerifyCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, recipe }: { slug: string; recipe?: Record<string, unknown> }) =>
      apiSend<VerifyResult>("POST", `/api/companies/${slug}/verify`, recipe ? { recipe } : {}),
    onSettled: (_result, _error, { recipe }) =>
      recipe ? undefined : queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipe: Record<string, unknown>) =>
      apiSend<CompanySummary>("POST", "/api/companies", recipe),
    onSettled: () => queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}

export function useReplaceCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipe: CompanyRecipe) =>
      apiSend<CompanySummary>("PUT", `/api/companies/${recipe.slug}`, recipe),
    onSettled: () => queryClient.invalidateQueries({ queryKey: COMPANIES_KEY }),
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => apiGet<Stats>("/api/stats"),
  });
}

/**
 * What saving this profile would do (tier counts before and after), without saving. Cached per
 * profile content; `null` pauses it.
 */
export function useProfilePreview(profile: Profile | null) {
  return useQuery({
    queryKey: ["profile", "preview", profile],
    queryFn: () => apiSend<ProfileSaveResponse>("PUT", "/api/profile?dryRun=true", profile),
    enabled: profile !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Saves the profile; the server re-scores every stored job, so job lists and stats are stale. */
export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: Profile) => apiSend<ProfileSaveResponse>("PUT", "/api/profile", profile),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profile"] }),
        queryClient.invalidateQueries({ queryKey: JOBS_KEY }),
        queryClient.invalidateQueries({ queryKey: ["stats"] }),
      ]),
  });
}
