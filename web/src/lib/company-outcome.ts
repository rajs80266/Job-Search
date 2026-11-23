import type { CompanySummary, VerifyResult } from "@server/types";

/** What the last "Verify now" for a company did, kept in the page until the next action. */
export type CompanyOutcome =
  | { state: "running" }
  | { state: "done"; result: VerifyResult }
  | { state: "error"; message: string };

/** One line for the table, e.g. "20 jobs on the first page (1.2 s)". */
export function describeVerify(result: VerifyResult): string {
  if (!result.ok) return result.error ?? "Verification failed";
  const seconds = (result.durationMs / 1000).toFixed(1);
  const jobs = result.jobCount === 1 ? "1 job" : `${result.jobCount} jobs`;
  return `${jobs} on the first page (${seconds} s)`;
}

/** The status to give a company that is switched back on: it must pass verify again. */
export function statusWhenEnabled(summary: CompanySummary): "unverified" | "needs-manual" {
  const { recipe } = summary;
  return recipe.ats === "manual" || !recipe.fetch ? "needs-manual" : "unverified";
}

const TOGGLEABLE: readonly string[] = ["verified", "unverified", "broken", "disabled"];

export function canToggle(summary: CompanySummary): boolean {
  return TOGGLEABLE.includes(summary.recipe.status);
}
