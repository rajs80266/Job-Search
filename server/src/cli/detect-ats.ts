import { detectAts } from "../lib/detect-ats";
import { createHttpClient } from "../lib/http";

async function main(): Promise<number> {
  const url = process.argv[2];
  if (!url || url.startsWith("-")) {
    console.error("Usage: npm run detect:ats -- <careers-page-url>");
    return 2;
  }

  const result = await detectAts(url, createHttpClient());
  console.log(JSON.stringify(result, null, 2));
  return result.ats ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
