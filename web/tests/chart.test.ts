import { describe, expect, it } from "vitest";
import { barShapes, shortDate, sharePercent } from "../src/lib/chart";

describe("barShapes", () => {
  it("scales bars to the busiest day and splits out the strong part", () => {
    expect(
      barShapes([
        { date: "2026-11-01", count: 4, highOrMedium: 1 },
        { date: "2026-11-02", count: 2, highOrMedium: 2 },
        { date: "2026-11-03", count: 0, highOrMedium: 0 },
      ]),
    ).toEqual([
      { totalPercent: 100, strongPercent: 25 },
      { totalPercent: 50, strongPercent: 100 },
      { totalPercent: 0, strongPercent: 0 },
    ]);
  });

  it("draws flat bars when nothing happened", () => {
    expect(barShapes([{ date: "2026-11-01", count: 0, highOrMedium: 0 }])).toEqual([
      { totalPercent: 0, strongPercent: 0 },
    ]);
    expect(barShapes([])).toEqual([]);
  });
});

describe("shortDate", () => {
  it("formats a local date without shifting the day", () => {
    expect(shortDate("2026-11-20")).toBe("20 Nov");
    expect(shortDate("2026-01-01")).toBe("1 Jan");
    expect(shortDate("garbage")).toBe("garbage");
  });
});

describe("sharePercent", () => {
  it("keeps a small non-zero value visible and a zero value empty", () => {
    expect(sharePercent(50, 100)).toBe(50);
    expect(sharePercent(1, 1000)).toBe(2);
    expect(sharePercent(0, 100)).toBe(0);
    expect(sharePercent(5, 0)).toBe(0);
    expect(sharePercent(500, 100)).toBe(100);
  });
});
