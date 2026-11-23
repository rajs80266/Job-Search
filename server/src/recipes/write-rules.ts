import { isDeepStrictEqual } from "node:util";
import { type CompanyRecipe, REFRESHABLE_STATUSES } from "../types";

export class RecipeWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeWriteError";
  }
}

const isProven = (recipe: CompanyRecipe): boolean => REFRESHABLE_STATUSES.includes(recipe.status);

function integrationOf(recipe: CompanyRecipe) {
  return {
    ats: recipe.ats,
    fetch: recipe.fetch,
    fieldMap: recipe.fieldMap,
    filters: recipe.filters,
  };
}

/**
 * ARCHITECTURE §2 "Status lifecycle", applied to a recipe sent by a client. Only verify may set
 * `verified`/`broken`, `verifiedOn` and `lastError`, so the client's values for them are ignored:
 * - a new recipe cannot arrive proven;
 * - editing ats, fetch, fieldMap or filters, or asking for `unverified`, drops the proof;
 * - otherwise the stored proof (status, verifiedOn, lastError) is kept.
 */
export function resolveRecipeWrite(
  stored: CompanyRecipe | undefined,
  incoming: CompanyRecipe,
): CompanyRecipe {
  const clientFields: CompanyRecipe = { ...incoming, verifiedOn: undefined, lastError: undefined };
  const unproven: CompanyRecipe = { ...clientFields, status: "unverified" };

  if (!stored) {
    if (isProven(incoming)) {
      throw new RecipeWriteError(
        "A new company cannot be verified or broken: save it as unverified, then verify it",
      );
    }
    return { ...clientFields };
  }

  const integrationChanged = !isDeepStrictEqual(integrationOf(stored), integrationOf(incoming));
  if (integrationChanged || incoming.status === "unverified") {
    return incoming.status === "needs-manual" || incoming.status === "disabled"
      ? { ...clientFields }
      : unproven;
  }

  const keptProof = {
    ...(stored.verifiedOn && { verifiedOn: stored.verifiedOn }),
    ...(stored.lastError && { lastError: stored.lastError }),
  };
  if (isProven(incoming)) {
    return isProven(stored) ? { ...clientFields, ...keptProof, status: stored.status } : unproven;
  }
  return { ...clientFields, ...keptProof };
}
