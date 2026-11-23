import type { CompanySummary } from "@server/types";
import { useState } from "react";
import { type CompanyOutcome, statusWhenEnabled } from "../lib/company-outcome";
import { useReplaceCompany, useVerifyCompany } from "./hooks";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "Something went wrong";

/** "Verify now" and enable/disable for the Companies page. `notify` shows a toast. */
export function useCompanyActions(notify: (text: string) => void) {
  const verify = useVerifyCompany();
  const replace = useReplaceCompany();
  const [outcomes, setOutcomes] = useState<Record<string, CompanyOutcome>>({});

  const setOutcome = (slug: string, outcome: CompanyOutcome): void =>
    setOutcomes((current) => ({ ...current, [slug]: outcome }));

  const verifyNow = async (slug: string, name: string): Promise<void> => {
    setOutcome(slug, { state: "running" });
    try {
      const result = await verify.mutateAsync({ slug });
      setOutcome(slug, { state: "done", result });
      notify(`${name}: ${result.ok ? "verified" : "verification failed"}`);
    } catch (error) {
      setOutcome(slug, { state: "error", message: messageOf(error) });
    }
  };

  const toggleEnabled = async (summary: CompanySummary): Promise<void> => {
    const { recipe } = summary;
    const enabling = recipe.status === "disabled";
    const status = enabling ? statusWhenEnabled(summary) : "disabled";
    try {
      await replace.mutateAsync({ ...recipe, status });
    } catch (error) {
      setOutcome(recipe.slug, { state: "error", message: messageOf(error) });
      return;
    }
    if (!enabling) {
      setOutcomes((current) =>
        Object.fromEntries(Object.entries(current).filter(([slug]) => slug !== recipe.slug)),
      );
      notify(`${recipe.name} disabled. It will not be refreshed.`);
    } else if (status === "unverified") await verifyNow(recipe.slug, recipe.name);
  };

  return {
    outcomes,
    verifyNow,
    toggleEnabled,
    isVerifying: (slug: string) => outcomes[slug]?.state === "running",
    isSaving: replace.isPending,
  };
}
