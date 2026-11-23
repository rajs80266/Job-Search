import type { Adapter, CompanyRecipe, FetchContext, FetchOutcome, FetchedJob } from "../types";

export interface DrainedFetch {
  jobs: FetchedJob[];
  outcome: FetchOutcome;
}

/** Collects every job an adapter yields, plus the outcome it returns at the end. */
export async function drainAdapter(
  adapter: Adapter,
  recipe: CompanyRecipe,
  ctx: FetchContext,
): Promise<DrainedFetch> {
  const generator = adapter.fetchJobs(recipe, ctx);
  const jobs: FetchedJob[] = [];
  for (;;) {
    const step = await generator.next();
    if (step.done) return { jobs, outcome: step.value };
    jobs.push(step.value);
  }
}
