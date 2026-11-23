import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Profile, ProfileSchema } from "../types";
import { formatZodIssues } from "../lib/zod-error";

export function parseProfile(json: unknown): Profile {
  const result = ProfileSchema.safeParse(json);
  if (!result.success) throw new Error(`Invalid profile: ${formatZodIssues(result.error)}`);
  return result.data;
}

export function loadProfile(profilePath: string): Profile {
  return parseProfile(JSON.parse(readFileSync(profilePath, "utf8")));
}

/** Writes the profile atomically (temp file + rename), pretty-printed like the other data files. */
export function writeProfile(profilePath: string, profile: Profile): void {
  const temporaryPath = `${profilePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(profile, null, 2)}\n`);
  renameSync(temporaryPath, profilePath);
}
