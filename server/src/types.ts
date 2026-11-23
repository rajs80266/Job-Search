/**
 * Contracts for the India CX-AI job tracker. See docs/ARCHITECTURE.md.
 * Zod 4. The web app imports from this file with `import type` only.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const COMPANY_CATEGORIES = [
  "google-partner",
  "cx-vendor",
  "india-ai",
  "bpo",
  "product-bfsi",
] as const;

export const ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "eightfold",
  "oracle-hcm",
  "successfactors",
  "google-careers",
  "generic",
  "manual",
] as const;

/** "unverified" = written but not yet proven by verify:company. Refresh skips it. */
export const RECIPE_STATUSES = [
  "unverified",
  "verified",
  "needs-manual",
  "broken",
  "disabled",
] as const;

export const RELEVANCE_TIERS = ["high", "medium", "low", "none"] as const;

export const JOB_STATUSES = ["saved", "applied", "interviewing", "rejected", "ignored"] as const;

export const CompanyCategorySchema = z.enum(COMPANY_CATEGORIES);
export const AtsSchema = z.enum(ATS_TYPES);
export const RecipeStatusSchema = z.enum(RECIPE_STATUSES);
export const RelevanceTierSchema = z.enum(RELEVANCE_TIERS);
export const JobStatusSchema = z.enum(JOB_STATUSES);

export type CompanyCategory = z.infer<typeof CompanyCategorySchema>;
export type Ats = z.infer<typeof AtsSchema>;
export type FetchableAts = Exclude<Ats, "manual">;
export type RecipeStatus = z.infer<typeof RecipeStatusSchema>;
export type RelevanceTier = z.infer<typeof RelevanceTierSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Statuses that a refresh run fetches. */
export const REFRESHABLE_STATUSES: readonly RecipeStatus[] = ["verified", "broken"];

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and single dashes");

const HttpUrlSchema = z.url({ protocol: /^https?$/ });

/** Headers that carry credentials or sessions. Recipes must never contain them. */
export const FORBIDDEN_HEADER_PATTERN =
  /cookie|authorization|auth|token|session|csrf|xsrf|api[-_]?key/i;

/** Placeholder replaced by each keyword in generic recipes' fetch.url / fetch.body. */
export const KEYWORD_PLACEHOLDER = "{{keyword}}";

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/** What an adapter yields: raw listing fields only. The refresh service derives the rest. */
export interface FetchedJob {
  externalId: string;
  title: string;
  /** Absolute http(s) URL of the job page. */
  url: string;
  /** "" if unknown. Multiple locations joined with " | ". */
  locationRaw: string;
  /** As given by the ATS: ISO string, epoch number, or text like "Posted 3 Days Ago". */
  postedRaw: string | number | null;
  /** HTML or text from the listing response; "" if the listing has none. */
  description: string;
  /** Adapter-specific handle for Adapter.fetchDescription (e.g. Workday externalPath). */
  detailRef?: string;
}

export interface NormalizedJob {
  /** First 16 hex chars of sha256(`${companySlug}\n${externalId}`). */
  id: string;
  companySlug: string;
  externalId: string;
  title: string;
  url: string;
  locationRaw: string;
  /** Canonical city names from profile.cities, plus "Remote" when isRemote. */
  cities: string[];
  isIndia: boolean;
  isRemote: boolean;
  /** ISO 8601 UTC, or null when the ATS gives no usable date. */
  postedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Set when a complete fetch no longer returns the job; cleared if it reappears. */
  closedAt: string | null;
  /** Plain text, whitespace collapsed, max DESCRIPTION_SNIPPET_MAX chars; scoring reads all of it, the UI shortens it. */
  descriptionSnippet: string;
  relevanceScore: number;
  relevanceTier: RelevanceTier;
  matchedKeywords: string[];
}

/** Long enough for whole postings (the longest of 77 sampled was 12.7k), so keywords late in a posting still score. */
export const DESCRIPTION_SNIPPET_MAX = 12_000;

// ---------------------------------------------------------------------------
// Company recipe (server/data/companies/<slug>.json)
// ---------------------------------------------------------------------------

export const PaginationSchema = z.object({
  /** Hard cap on pages per query. */
  maxPages: z.number().int().min(1).max(20).default(5),
  /** Omit to use the adapter's default page size. */
  pageSize: z.number().int().min(1).max(200).optional(),
  /** Only when true may a refresh stop early on a page of known IDs. */
  sortedNewestFirst: z.boolean().default(false),
  /** Generic adapter only: how to request the next page. */
  type: z.enum(["none", "offset", "page"]).default("none"),
  /** Generic only: query param name (GET) or dot path in the body (POST). */
  param: z.string().min(1).optional(),
  /** Generic only: query param / body dot path that carries pageSize. */
  sizeParam: z.string().min(1).optional(),
  /** Generic only: first offset or page number. Default 0 for offset, 1 for page. */
  start: z.number().int().min(0).optional(),
});

export const FetchSpecSchema = z.object({
  /** The real listing request URL, as seen in the browser or built from tokens seen there. */
  url: HttpUrlSchema,
  method: z.enum(["GET", "POST"]).default("GET"),
  headers: z.record(z.string(), z.string()).default({}),
  /** JSON body for POST listing calls (e.g. Workday /jobs), copied from a real request. */
  body: z.record(z.string(), z.unknown()).optional(),
  pagination: PaginationSchema.default({
    maxPages: 5,
    sortedNewestFirst: false,
    type: "none",
  }),
});

/** Dot paths ("a.b.0.c") into the generic JSON response. "" for jobsPath = response is the array. */
export const FieldMapSchema = z
  .object({
    jobsPath: z.string(),
    externalId: z.string().min(1),
    title: z.string().min(1),
    /** Path to an absolute or relative job URL (resolved against fetch.url). */
    url: z.string().min(1).optional(),
    /** Alternative to url, e.g. "https://x.com/jobs/{{id}}"; {{path}} is a dot path in the job. */
    urlTemplate: z.string().min(1).optional(),
    /** May point to a string or an array of strings. */
    location: z.string().min(1).optional(),
    postedAt: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    /** Optional path to the total job count, used to stop paging. */
    totalPath: z.string().min(1).optional(),
  })
  .refine((map) => Boolean(map.url) !== Boolean(map.urlTemplate), {
    message: "exactly one of url or urlTemplate is required",
    path: ["url"],
  });

export const FiltersSchema = z.object({
  /** Sent to the ATS search, one query per keyword, results merged. [] = one unfiltered query. */
  keywords: z.array(z.string().trim().min(1)).max(6).default([]),
  /** ATS-native location value seen in a real request (e.g. SmartRecruiters "in"). */
  location: z.string().min(1).optional(),
  /** True when the request itself restricts results to India; unparseable locations count as India. */
  indiaFiltered: z.boolean().default(false),
});

const DEFAULT_FILTERS = { keywords: [], indiaFiltered: false };

const STATUSES_NEEDING_FETCH: readonly RecipeStatus[] = ["unverified", "verified", "broken"];

export const CompanyRecipeSchema = z
  .object({
    slug: SlugSchema,
    name: z.string().trim().min(1),
    category: CompanyCategorySchema,
    careersUrl: HttpUrlSchema,
    ats: AtsSchema,
    fetch: FetchSpecSchema.optional(),
    fieldMap: FieldMapSchema.optional(),
    filters: FiltersSchema.default(DEFAULT_FILTERS),
    manualSearchUrl: HttpUrlSchema.optional(),
    status: RecipeStatusSchema,
    /** YYYY-MM-DD of the last successful verify:company. Kept when a later verify fails. */
    verifiedOn: z.iso.date().optional(),
    /** Last verify:company error. Refresh errors live in SQLite, not here. */
    lastError: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((recipe, ctx) => {
    const fail = (path: string[], message: string): void => {
      ctx.addIssue({ code: "custom", path, message });
    };

    if (recipe.ats === "manual") {
      if (recipe.fetch) fail(["fetch"], "manual recipes have no fetch");
      if (recipe.status !== "needs-manual" && recipe.status !== "disabled") {
        fail(["status"], "manual recipes must be needs-manual or disabled");
      }
    } else if (STATUSES_NEEDING_FETCH.includes(recipe.status) && !recipe.fetch) {
      fail(["fetch"], `fetch is required when status is ${recipe.status}`);
    }

    if (REFRESHABLE_STATUSES.includes(recipe.status) && !recipe.verifiedOn) {
      fail(
        ["verifiedOn"],
        `${recipe.status} recipes must have passed verify at least once (verifiedOn)`,
      );
    }
    if (recipe.status === "needs-manual") {
      if (!recipe.manualSearchUrl)
        fail(["manualSearchUrl"], "needs-manual requires manualSearchUrl");
      if (!recipe.notes) fail(["notes"], "needs-manual requires a notes reason");
    }

    if (recipe.ats === "generic" && !recipe.fieldMap)
      fail(["fieldMap"], "generic recipes need fieldMap");
    if (recipe.ats !== "generic" && recipe.fieldMap)
      fail(["fieldMap"], "fieldMap is only for generic");

    const fetchSpec = recipe.fetch;
    if (!fetchSpec) return;

    if (fetchSpec.method === "GET" && fetchSpec.body)
      fail(["fetch", "body"], "GET requests have no body");
    for (const name of Object.keys(fetchSpec.headers)) {
      if (FORBIDDEN_HEADER_PATTERN.test(name)) {
        fail(["fetch", "headers", name], "credential/session headers are not allowed");
      }
    }

    if (recipe.ats === "generic") {
      const { pagination } = fetchSpec;
      if (pagination.type !== "none" && !pagination.param) {
        fail(["fetch", "pagination", "param"], "param is required for offset/page pagination");
      }
      const requestText = fetchSpec.url + JSON.stringify(fetchSpec.body ?? {});
      if (recipe.filters.keywords.length > 0 && !requestText.includes(KEYWORD_PLACEHOLDER)) {
        fail(
          ["filters", "keywords"],
          `generic keywords need ${KEYWORD_PLACEHOLDER} in fetch.url or fetch.body`,
        );
      }
    }
  });

export type Pagination = z.infer<typeof PaginationSchema>;
export type FetchSpec = z.infer<typeof FetchSpecSchema>;
export type FieldMap = z.infer<typeof FieldMapSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type CompanyRecipe = z.infer<typeof CompanyRecipeSchema>;
/** Shape of the JSON file before defaults are applied. */
export type CompanyRecipeInput = z.input<typeof CompanyRecipeSchema>;

// ---------------------------------------------------------------------------
// Profile (server/data/profile.json) – see ARCHITECTURE.md "Relevance"
// ---------------------------------------------------------------------------

/**
 * The one text normalization used by scoring and location parsing (and the profile's
 * duplicate-phrase check): strip accents, lowercase, every run of non [a-z0-9] becomes one
 * space. "Kore.ai" -> "kore ai", "CCAI-P" -> "ccai p", "Remote – APAC" -> "remote apac".
 */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PhraseSchema = z
  .string()
  .trim()
  .min(1)
  .refine((phrase) => normalizeForMatching(phrase) !== "", "phrase must contain a letter or digit");

/** A concept: the term and its aliases count as one match; `term` is what matchedKeywords shows. */
export const TermSchema = z.object({
  term: PhraseSchema,
  /** Synonyms and spelling variants, matched like the term itself. */
  aliases: z.array(PhraseSchema).default([]),
});

export const NegativeTermSchema = TermSchema.extend({
  /** Subtracted once per concept, however often it appears. */
  penalty: z.number().positive(),
  /** Phrases that cancel the match where they occur, e.g. "pre sales" for "sales". */
  except: z.array(PhraseSchema).default([]),
  scope: z.enum(["title", "titleAndDescription"]).default("title"),
});

const FieldWeightsSchema = z.object({
  title: z.number().min(0),
  description: z.number().min(0),
});

export const CitySchema = z.object({
  /** Canonical name stored in NormalizedJob.cities. */
  name: PhraseSchema,
  aliases: z.array(PhraseSchema).default([]),
});

/** The candidate's own preferences. Not used in scoring; the UI uses preferredCities for filters. */
export const CandidateSchema = z.object({
  experienceYears: z.object({ min: z.number().int().min(0), max: z.number().int().min(0) }),
  targetLevels: z.array(z.string().trim().min(1)),
  /** Canonical city names from `cities`, or "Remote". */
  preferredCities: z.array(z.string().trim().min(1)),
  openToRelocation: z.boolean(),
});

/** City value added to NormalizedJob.cities for remote jobs. */
export const REMOTE_CITY = "Remote";

export const ProfileSchema = z
  .object({
    candidate: CandidateSchema,
    keywords: z.object({
      core: z.array(TermSchema).min(1),
      adjacent: z.array(TermSchema),
    }),
    weights: z.object({
      core: FieldWeightsSchema,
      adjacent: FieldWeightsSchema,
      /** Added once when the title has a core concept and a role term. */
      roleBonus: z.number().min(0),
      /** Maximum points the description can add. */
      descriptionCap: z.number().min(0),
    }),
    /** Title words that mark an engineering/consulting job, e.g. "engineer", "architect". */
    roleTerms: z.array(PhraseSchema).min(1),
    negativeTerms: z.array(NegativeTermSchema),
    /** Minimum score per tier; below `low` is "none". */
    tiers: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
    cities: z.array(CitySchema).min(1),
    /** Location words that mean India without a city, e.g. "India", "Pan India", state names. */
    indiaTerms: z.array(PhraseSchema).min(1),
    /** Location words that mean remote, e.g. "Remote", "Work from home". */
    remoteTerms: z.array(PhraseSchema).min(1),
    /** Regions that include India; remote + one of these counts as India, e.g. "Remote – APAC". */
    remoteRegionTerms: z.array(PhraseSchema).default([]),
    /**
     * Countries and regions that exclude India. A location part that names one of these (and no
     * India term) is not India even if it also names a city or region shared with India.
     */
    foreignCountryTerms: z.array(PhraseSchema).default([]),
  })
  .superRefine((profile, ctx) => {
    const fail = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: "custom", path, message });
    };

    const { tiers } = profile;
    if (!(tiers.high > tiers.medium && tiers.medium > tiers.low && tiers.low > 0)) {
      fail(["tiers"], "tiers must satisfy high > medium > low > 0");
    }
    const { experienceYears } = profile.candidate;
    if (experienceYears.min > experienceYears.max) {
      fail(["candidate", "experienceYears"], "min must be <= max");
    }

    // A phrase in two positive concepts would make the match depend on list order.
    const conceptByPhrase = new Map<string, string>();
    for (const [group, terms] of Object.entries(profile.keywords)) {
      terms.forEach((concept, index) => {
        for (const phrase of [concept.term, ...concept.aliases]) {
          const key = normalizeForMatching(phrase);
          const owner = conceptByPhrase.get(key);
          if (owner !== undefined && owner !== concept.term) {
            fail(["keywords", group, index], `"${phrase}" is already used by "${owner}"`);
          }
          conceptByPhrase.set(key, concept.term);
        }
      });
    }

    const cityNames = new Set(profile.cities.map((city) => city.name));
    profile.candidate.preferredCities.forEach((name, index) => {
      if (name !== REMOTE_CITY && !cityNames.has(name)) {
        fail(["candidate", "preferredCities", index], `"${name}" is not a city name in cities`);
      }
    });
  });

export type Term = z.infer<typeof TermSchema>;
export type NegativeTerm = z.infer<typeof NegativeTermSchema>;
export type City = z.infer<typeof CitySchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileInput = z.input<typeof ProfileSchema>;

/** One case in server/tests/fixtures/relevance-golden.json. */
export interface RelevanceGoldenCase {
  id: string;
  title: string;
  description: string;
  location: string;
  indiaFiltered?: boolean;
  expected: { tier: RelevanceTier; isIndia: boolean };
  why: string;
}

export interface RelevanceResult {
  relevanceScore: number;
  relevanceTier: RelevanceTier;
  matchedKeywords: string[];
}

export interface ParsedLocation {
  cities: string[];
  isIndia: boolean;
  isRemote: boolean;
}

// ---------------------------------------------------------------------------
// HTTP client and adapters
// ---------------------------------------------------------------------------

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** JSON-encoded by the client. */
  body?: unknown;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  /** Final URL after redirects. */
  url: string;
  text: string;
  json<T = unknown>(): T;
}

/**
 * Rate-limited (1 req/s per host), 15 s timeout, 2 retries with backoff.
 * Resolves only for 2xx; throws an HttpError otherwise.
 */
export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export interface FetchContext {
  http: HttpClient;
  /** Aborts on the per-company time budget. */
  signal: AbortSignal;
  /** Effective keywords: recipe.filters.keywords, or [] in verify mode. Adapters never read recipe.filters.keywords. */
  keywords: readonly string[];
  /** Effective page cap per query: recipe.fetch.pagination.maxPages, or 1 in verify mode. */
  maxPages: number;
  /** External IDs of this company's open jobs. Empty in full and verify modes. */
  knownExternalIds: ReadonlySet<string>;
  now: Date;
}

export type StopReason = "end" | "known-ids" | "page-cap";

export interface FetchOutcome {
  /** True only if every query reached its natural end. Only complete fetches close jobs. */
  complete: boolean;
  stopReason: StopReason;
  pagesFetched: number;
}

/** One page from an ATS, as returned by an adapter's page function to the shared paginate helper. */
export interface PageResult {
  jobs: FetchedJob[];
  hasMore: boolean;
}

export interface Adapter {
  ats: FetchableAts;
  fetchJobs(
    recipe: CompanyRecipe,
    ctx: FetchContext,
  ): AsyncGenerator<FetchedJob, FetchOutcome, undefined>;
  /**
   * Only for ATSs whose listing has no description. Returns HTML or text for one job.
   * The refresh service decides which jobs to call it for (see ARCHITECTURE §5).
   */
  fetchDescription?(job: FetchedJob, recipe: CompanyRecipe, ctx: FetchContext): Promise<string>;
}

/** Partial while adapters are added step by step; a missing adapter fails that company only. */
export type AdapterRegistry = Partial<Record<FetchableAts, Adapter>>;

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export type RefreshMode = "incremental" | "full";
export type RefreshRunStatus = "running" | "finished" | "aborted";
export type CompanyResultStatus = "ok" | "failed" | "skipped";

export interface RefreshCompanyResult {
  runId: number;
  companySlug: string;
  status: CompanyResultStatus;
  mode: RefreshMode;
  startedAt: string;
  finishedAt: string | null;
  jobsFetched: number;
  jobsNew: number;
  jobsClosed: number;
  /** Dropped for missing externalId/title/url. */
  jobsInvalid: number;
  pagesFetched: number;
  /** Per-job description requests made / failed (failures keep the job, scored on title). */
  detailsFetched: number;
  detailsFailed: number;
  stopReason: StopReason | null;
  /** Failure or skip reason; also non-fatal warnings such as an empty complete fetch. */
  message: string | null;
}

export interface RefreshRunSummary {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: RefreshRunStatus;
  /** null = all refreshable companies. */
  companySlug: string | null;
  full: boolean;
  totals: {
    companies: number;
    ok: number;
    failed: number;
    skipped: number;
    jobsNew: number;
    jobsClosed: number;
  };
}

/** SSE payloads on GET /api/refresh/:runId/events. The SSE `event:` field equals `type`. */
export type RefreshEvent =
  | {
      type: "snapshot";
      run: RefreshRunSummary;
      results: RefreshCompanyResult[];
      /** Companies that have started but not finished (empty once the run has ended). */
      running: string[];
    }
  | { type: "company-started"; runId: number; companySlug: string; at: string }
  | { type: "company-finished"; result: RefreshCompanyResult }
  | { type: "run-finished"; run: RefreshRunSummary };

// ---------------------------------------------------------------------------
// REST API
// ---------------------------------------------------------------------------

export interface ApiError {
  error: "validation" | "forbidden" | "not-found" | "conflict" | "internal";
  message: string;
  details?: unknown;
}

function commaList<T extends z.ZodType<string, string>>(item: T) {
  return z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).min(1));
}

export const JOB_SORTS = ["relevance", "posted", "firstSeen"] as const;

/** GET /api/jobs and GET /api/export.csv (export ignores page/pageSize). */
export const JobsQuerySchema = z.object({
  /** Case-insensitive substring over title, company name, location and snippet. */
  q: z.string().trim().min(1).optional(),
  company: commaList(SlugSchema).optional(),
  category: commaList(CompanyCategorySchema).optional(),
  tier: commaList(RelevanceTierSchema).optional(),
  city: z.string().trim().min(1).optional(),
  /** Omitted = all except "ignored". "none" = no status set. */
  status: z.union([JobStatusSchema, z.literal("none")]).optional(),
  isNew: z.stringbool().optional(),
  india: z.enum(["true", "false", "all"]).default("true"),
  remote: z.stringbool().optional(),
  includeClosed: z.stringbool().default(false),
  sort: z.enum(JOB_SORTS).default("relevance"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type JobsQuery = z.infer<typeof JobsQuerySchema>;

export interface JobListItem extends NormalizedJob {
  companyName: string;
  category: CompanyCategory;
  isNew: boolean;
  status: JobStatus | null;
  notes: string;
  statusUpdatedAt: string | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** PATCH /api/jobs/:id/status. status null clears it; notes "" clears notes. */
export const JobStatusUpdateSchema = z
  .object({
    status: JobStatusSchema.nullable().optional(),
    notes: z.string().max(5000).optional(),
  })
  .refine((body) => body.status !== undefined || body.notes !== undefined, {
    message: "status or notes is required",
  });

export type JobStatusUpdate = z.infer<typeof JobStatusUpdateSchema>;

export interface JobStatusRecord {
  jobId: string;
  status: JobStatus | null;
  notes: string;
  updatedAt: string;
}

/** POST /api/refresh -> 202 RefreshStarted, or 409 ApiError with details { runId }. */
export const RefreshRequestSchema = z.object({
  company: SlugSchema.optional(),
  full: z.boolean().default(false),
});

export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export interface RefreshStarted {
  runId: number;
}

export interface CompanyRuntime {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  /** Last refresh error; null after a successful fetch. */
  lastRefreshError: string | null;
  /** Open India jobs (what the Jobs page shows by default). */
  openJobs: number;
  /** Open India jobs that are new (ARCHITECTURE §6). */
  newJobs: number;
}

export interface CompanySummary {
  recipe: CompanyRecipe;
  runtime: CompanyRuntime;
}

/** GET /api/companies */
export interface CompanyList {
  companies: CompanySummary[];
  /** Recipe files that failed schema validation; they are not refreshed. */
  invalidFiles: { file: string; error: string }[];
}

/** POST /api/companies/:slug/verify. With `recipe`, tests it without saving (dry run). */
export const VerifyRequestSchema = z.object({
  recipe: CompanyRecipeSchema.optional(),
});

export interface VerifyResult {
  ok: boolean;
  jobCount: number;
  sampleTitles: string[];
  error: string | null;
  /** Non-fatal problems, e.g. the sample description request failed. */
  warnings: string[];
  durationMs: number;
  /** False for dry runs. */
  saved: boolean;
}

/** POST /api/companies/import-curl */
export const ImportCurlRequestSchema = z.object({
  /** A pasted "Copy as cURL (bash)" or "Copy as fetch" string. */
  text: z.string().min(1).max(100_000),
  slug: SlugSchema.optional(),
  name: z.string().trim().min(1).optional(),
  category: CompanyCategorySchema.optional(),
});

export type CompanyRecipeDraft = Partial<CompanyRecipeInput> & {
  ats: Ats;
  fetch: z.input<typeof FetchSpecSchema>;
  status: "unverified";
};

export interface ImportCurlResponse {
  draft: CompanyRecipeDraft;
  /** Header names removed (credentials, cookies, browser noise). */
  strippedHeaders: string[];
  detectedAts: Ats | null;
  warnings: string[];
}

export type TierCounts = Record<RelevanceTier, number>;

/** PUT /api/profile[?dryRun=true]. Body: Profile. Re-normalizes and re-scores stored jobs, no re-fetch. */
export interface ProfileSaveResponse {
  saved: boolean;
  rescored: number;
  before: TierCounts;
  after: TierCounts;
}

/** GET /api/stats. Counts are for open India jobs unless noted. Days are in the machine's local time. */
export interface Stats {
  /** Jobs that were new when first seen (jobs from a company's first fetch are excluded). */
  newPerDay: { date: string; count: number; highOrMedium: number }[];
  perCompany: {
    slug: string;
    name: string;
    open: number;
    new: number;
    high: number;
    medium: number;
  }[];
  /** All jobs with a status, open or closed. */
  funnel: Record<JobStatus, number>;
  tiers: TierCounts;
  lastRun: RefreshRunSummary | null;
}

export interface DetectAtsResult {
  inputUrl: string;
  ats: Ats | null;
  /** Which URL patterns or HTML markers matched. */
  evidence: string[];
  /** Built only from tokens actually present in the URL or HTML; null if none. */
  candidateApiUrl: string | null;
}
