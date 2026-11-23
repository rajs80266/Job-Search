import type { CompanyCategory, JobStatus, RelevanceTier } from "@server/types";
import { CATEGORIES, JOB_STATUS_VALUES, TIERS } from "./labels";

export type IndiaFilter = "true" | "false" | "all";
export type JobSort = "relevance" | "posted" | "firstSeen";
export type StatusFilter = "" | "none" | JobStatus;

export interface JobFilters {
  q: string;
  company: string[];
  category: CompanyCategory[];
  tier: RelevanceTier[];
  city: string;
  status: StatusFilter;
  isNew: boolean;
  india: IndiaFilter;
  remote: boolean;
  includeClosed: boolean;
  sort: JobSort;
  page: number;
  pageSize: number;
}

/** "None" tier jobs are noise for most searches, so the default view leaves them out. */
export const DEFAULT_TIERS: readonly RelevanceTier[] = ["high", "medium", "low"];
export const DEFAULT_PAGE_SIZE = 50;
export const PAGE_SIZES = [25, 50, 100, 200] as const;

const INDIA_VALUES: readonly IndiaFilter[] = ["true", "false", "all"];
const SORT_VALUES: readonly JobSort[] = ["relevance", "posted", "firstSeen"];

function pickAllowed<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

function parseList<T extends string>(value: string | null, allowed?: readonly T[]): T[] {
  const parts = (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean) as T[];
  return allowed ? parts.filter((part) => allowed.includes(part)) : parts;
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/** The URL is the single source of truth; unknown or invalid values fall back to defaults. */
export function parseFilters(params: URLSearchParams): JobFilters {
  const requestedTiers = parseList(params.get("tier"), TIERS);
  const tiers = TIERS.filter((tier) => requestedTiers.includes(tier));
  const pageSize = parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE);
  return {
    q: params.get("q")?.trim() ?? "",
    company: parseList(params.get("company")),
    category: parseList(params.get("category"), CATEGORIES),
    tier: tiers.length > 0 ? tiers : [...DEFAULT_TIERS],
    city: params.get("city") ?? "",
    status: pickAllowed(params.get("status"), ["none", ...JOB_STATUS_VALUES] as const) ?? "",
    isNew: params.get("isNew") === "true",
    india: pickAllowed(params.get("india"), INDIA_VALUES) ?? "true",
    remote: params.get("remote") === "true",
    includeClosed: params.get("includeClosed") === "true",
    sort: pickAllowed(params.get("sort"), SORT_VALUES) ?? "relevance",
    page: parsePositiveInt(params.get("page"), 1),
    pageSize: Math.min(pageSize, 200),
  };
}

/** Only non-default values, so shared URLs stay short. */
export function toSearchParams(filters: JobFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.company.length > 0) params.set("company", filters.company.join(","));
  if (filters.category.length > 0) params.set("category", filters.category.join(","));
  if (!sameMembers(filters.tier, DEFAULT_TIERS)) params.set("tier", filters.tier.join(","));
  if (filters.city) params.set("city", filters.city);
  if (filters.status) params.set("status", filters.status);
  if (filters.isNew) params.set("isNew", "true");
  if (filters.india !== "true") params.set("india", filters.india);
  if (filters.remote) params.set("remote", "true");
  if (filters.includeClosed) params.set("includeClosed", "true");
  if (filters.sort !== "relevance") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(filters.pageSize));
  return params;
}

/** Query string for GET /api/jobs: defaults are always spelled out so the UI never relies on API defaults. */
export function toApiQuery(filters: JobFilters): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.company.length > 0) params.set("company", filters.company.join(","));
  if (filters.category.length > 0) params.set("category", filters.category.join(","));
  if (filters.tier.length > 0) params.set("tier", filters.tier.join(","));
  if (filters.city) params.set("city", filters.city);
  if (filters.status) params.set("status", filters.status);
  if (filters.isNew) params.set("isNew", "true");
  if (filters.remote) params.set("remote", "true");
  params.set("india", filters.india);
  params.set("includeClosed", String(filters.includeClosed));
  params.set("sort", filters.sort);
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  return params.toString();
}

const FILTER_KEYS_AFFECTING_RESULTS = [
  "q",
  "company",
  "category",
  "tier",
  "city",
  "status",
  "isNew",
  "india",
  "remote",
  "includeClosed",
] as const;

/** True when anything besides sort and paging differs from the default view. */
export function hasActiveFilters(filters: JobFilters): boolean {
  const defaults = parseFilters(new URLSearchParams());
  return FILTER_KEYS_AFFECTING_RESULTS.some(
    (key) => JSON.stringify(filters[key]) !== JSON.stringify(defaults[key]),
  );
}
