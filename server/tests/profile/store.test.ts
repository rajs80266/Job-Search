import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProfile, writeProfile } from "../../src/profile/store";
import { makeTempDir, testProfile } from "../helpers";

describe("writeProfile", () => {
  it("writes a file that loads back to the same profile, with a trailing newline", () => {
    const file = path.join(makeTempDir(), "profile.json");

    writeProfile(file, testProfile);

    expect(loadProfile(file)).toEqual(testProfile);
    expect(readFileSync(file, "utf8").endsWith("}\n")).toBe(true);
  });
});
