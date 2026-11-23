import type { Adapter, AdapterRegistry, CompanyRecipe, FetchableAts } from "../types";
import { ashbyAdapter } from "./ashby";
import { eightfoldAdapter } from "./eightfold";
import { genericAdapter } from "./generic";
import { googleCareersAdapter } from "./google-careers";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { oracleHcmAdapter } from "./oracle-hcm";
import { smartRecruitersAdapter } from "./smartrecruiters";
import { successFactorsAdapter } from "./successfactors";
import { workableAdapter } from "./workable";
import { workdayAdapter } from "./workday";

export const adapterRegistry: AdapterRegistry = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  smartrecruiters: smartRecruitersAdapter,
  workable: workableAdapter,
  workday: workdayAdapter,
  eightfold: eightfoldAdapter,
  "oracle-hcm": oracleHcmAdapter,
  successfactors: successFactorsAdapter,
  "google-careers": googleCareersAdapter,
  generic: genericAdapter,
};

/** Fails only the company at hand when its ATS has no adapter yet. */
export function resolveAdapter(registry: AdapterRegistry, recipe: CompanyRecipe): Adapter {
  const adapter = registry[recipe.ats as FetchableAts];
  if (!adapter) throw new Error(`no adapter for ${recipe.ats}`);
  return adapter;
}
