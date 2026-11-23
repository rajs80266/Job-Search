export interface DayBar {
  date: string;
  count: number;
  highOrMedium: number;
}

export interface BarShape {
  /** Percent of the chart height, for the whole bar. */
  totalPercent: number;
  /** Percent of the bar that is high or medium (the part drawn in the accent colour). */
  strongPercent: number;
}

/** Heights are relative to the busiest day; an all-zero window gives flat bars. */
export function barShapes(days: readonly DayBar[]): BarShape[] {
  const max = Math.max(0, ...days.map((day) => day.count));
  return days.map((day) => ({
    totalPercent: max === 0 ? 0 : (day.count / max) * 100,
    strongPercent: day.count === 0 ? 0 : (day.highOrMedium / day.count) * 100,
  }));
}

/** "2026-11-20" -> "20 Nov", without a time zone shift. */
export function shortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Share of `value` in `total` as a percent for a bar width; never below `minimum` for a non-zero value. */
export function sharePercent(value: number, total: number, minimum = 2): number {
  if (value <= 0 || total <= 0) return 0;
  return Math.max(minimum, Math.min(100, (value / total) * 100));
}
