import { createHash } from "node:crypto";

export function makeJobId(companySlug: string, externalId: string): string {
  return createHash("sha256").update(`${companySlug}\n${externalId}`).digest("hex").slice(0, 16);
}
