import type { Ats, CompanyCategory, JobStatus, RecipeStatus, RelevanceTier } from "@server/types";

export const TIERS = ["high", "medium", "low", "none"] as const satisfies readonly RelevanceTier[];

export const JOB_STATUS_VALUES = [
  "saved",
  "applied",
  "interviewing",
  "rejected",
  "ignored",
] as const satisfies readonly JobStatus[];

export const CATEGORIES = [
  "google-partner",
  "cx-vendor",
  "india-ai",
  "bpo",
  "product-bfsi",
] as const satisfies readonly CompanyCategory[];

export const TIER_LABELS: Record<RelevanceTier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "None",
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  rejected: "Rejected",
  ignored: "Ignored",
};

export const CATEGORY_LABELS: Record<CompanyCategory, string> = {
  "google-partner": "Google partner",
  "cx-vendor": "CX vendor",
  "india-ai": "India AI",
  bpo: "BPO / CX services",
  "product-bfsi": "Product / BFSI",
};

/** Recipe statuses that a refresh run fetches (same as REFRESHABLE_STATUSES on the server). */
export const REFRESHABLE_STATUSES: readonly RecipeStatus[] = ["verified", "broken"];

export const RECIPE_STATUS_LABELS: Record<RecipeStatus, string> = {
  verified: "Verified",
  unverified: "Unverified",
  broken: "Broken",
  disabled: "Disabled",
  "needs-manual": "Check manually",
};

export const ATS_LABELS: Record<Ats, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
  workday: "Workday",
  eightfold: "Eightfold",
  "oracle-hcm": "Oracle HCM",
  successfactors: "SuccessFactors",
  "google-careers": "Google Careers",
  generic: "Generic JSON",
  manual: "Manual",
};
