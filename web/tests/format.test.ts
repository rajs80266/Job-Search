import { describe, expect, it } from "vitest";
import { formatDuration, formatRelative, pluralize } from "../src/lib/format";

const NOW = Date.parse("2026-11-23T12:00:00.000Z");

describe("formatRelative", () => {
  it.each([
    ["2026-11-23T11:59:40.000Z", "just now"],
    ["2026-11-23T12:00:30.000Z", "just now"],
    ["2026-11-23T11:55:00.000Z", "5m ago"],
    ["2026-11-23T09:00:00.000Z", "3h ago"],
    ["2026-11-20T12:00:00.000Z", "3d ago"],
  ])("%s -> %s", (iso, expected) => {
    expect(formatRelative(iso, NOW)).toBe(expected);
  });

  it("switches to a date after 30 days", () => {
    expect(formatRelative("2026-09-01T12:00:00.000Z", NOW)).toMatch(/1 Sep(t)? 2026/);
  });
});

describe("formatDuration", () => {
  it("formats short and long runs, and an unfinished one as empty", () => {
    expect(formatDuration("2026-11-23T09:00:00.000Z", "2026-11-23T09:00:01.250Z")).toBe("1.3s");
    expect(formatDuration("2026-11-23T09:00:00.000Z", "2026-11-23T09:00:49.000Z")).toBe("49s");
    expect(formatDuration("2026-11-23T09:00:00.000Z", null)).toBe("");
  });
});

describe("pluralize", () => {
  it("handles one and many", () => {
    expect(pluralize(1, "company", "companies")).toBe("1 company");
    expect(pluralize(3, "company", "companies")).toBe("3 companies");
    expect(pluralize(0, "job")).toBe("0 jobs");
  });
});
