import { parseArgs } from "node:util";
import { RECIPES_DIR } from "../config";
import { adapterRegistry } from "../adapters";
import { createHttpClient } from "../lib/http";
import { loadRecipes } from "../recipes/store";
import { isVerifiable, verifyAndSaveRecipe } from "../refresh/verify";
import type { VerifyResult } from "../types";

const USAGE = "Usage: npm run verify:company -- <slug> | --all";

function printResult(slug: string, result: VerifyResult): void {
  if (result.ok) {
    console.log(
      `OK     ${slug}: ${result.jobCount} job(s) on the first page (${result.durationMs} ms)`,
    );
    result.sampleTitles.forEach((title, index) => console.log(`         ${index + 1}. ${title}`));
  } else {
    console.log(`FAILED ${slug}: ${result.error ?? "unknown error"}`);
  }
  for (const warning of result.warnings) console.log(`         warning: ${warning}`);
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: { all: { type: "boolean", default: false } },
    allowPositionals: true,
  });

  const [slug] = positionals;
  if (values.all === (slug !== undefined)) {
    console.error(USAGE);
    return 2;
  }

  const slugs = slug
    ? [slug]
    : loadRecipes(RECIPES_DIR)
        .recipes.filter(isVerifiable)
        .map((recipe) => recipe.slug);
  const deps = { http: createHttpClient(), adapters: adapterRegistry };

  let allOk = true;
  for (const target of slugs) {
    const result = await verifyAndSaveRecipe(RECIPES_DIR, target, deps);
    printResult(target, result);
    allOk &&= result.ok;
  }
  return allOk ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
