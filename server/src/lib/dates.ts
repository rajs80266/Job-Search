const EPOCH_SECONDS_LIMIT = 1e11;
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;
const RELATIVE_AGE = /(\d+)\s*(minute|hour|day|week)s?\s+ago/i;
const MONTH_DAY_YEAR = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i;
const MONTH_PREFIXES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
};

function fromEpoch(value: number): string | null {
  const millis = value < EPOCH_SECONDS_LIMIT ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "November 16, 2026" or "Nov  4, 2026" as midnight UTC. */
function fromMonthDayYear(text: string): string | null {
  const match = MONTH_DAY_YEAR.exec(text);
  const month = MONTH_PREFIXES.indexOf((match?.[1] ?? "").toLowerCase());
  if (!match || month === -1) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2]))).toISOString();
}

function fromRelativeText(text: string, now: Date): string | null {
  const lower = text.toLowerCase();
  if (/\d\s*\+/.test(lower)) return null;
  if (/\btoday\b|\bjust now\b/.test(lower)) return now.toISOString();
  if (/\byesterday\b/.test(lower)) return new Date(now.getTime() - DAY_MS).toISOString();

  const match = RELATIVE_AGE.exec(lower);
  if (!match) return null;
  const unitMs = UNIT_MS[match[2] ?? ""];
  if (unitMs === undefined) return null;
  return new Date(now.getTime() - Number(match[1]) * unitMs).toISOString();
}

/** ISO text, epoch seconds/millis, "Month D, YYYY" or English relative text ("Posted 3 Days Ago") to ISO UTC. */
export function parsePostedAt(raw: string | number | null, now: Date): string | null {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? fromEpoch(raw) : null;

  const text = raw.trim();
  if (text === "") return null;
  if (/^\d+$/.test(text)) return fromEpoch(Number(text));
  if (ISO_LIKE.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return fromMonthDayYear(text) ?? fromRelativeText(text, now);
}

/** YYYY-MM-DD in the machine's local time zone. */
export function localDateString(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
