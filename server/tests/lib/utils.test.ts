import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../../src/lib/concurrency";
import { localDateString, parsePostedAt } from "../../src/lib/dates";
import { makeJobId } from "../../src/lib/job-id";
import { decodeHtmlEntities, toSnippet } from "../../src/lib/text";
import { DESCRIPTION_SNIPPET_MAX } from "../../src/types";

const NOW = new Date("2026-11-21T10:00:00.000Z");

describe("parsePostedAt", () => {
  it("normalizes ISO strings with offsets to UTC", () => {
    expect(parsePostedAt("2026-09-16T09:11:57-04:00", NOW)).toBe("2026-09-16T13:11:57.000Z");
    expect(parsePostedAt("2026-09-16", NOW)).toBe("2026-09-16T00:00:00.000Z");
  });

  it("reads epoch seconds and milliseconds, as numbers or digit strings", () => {
    expect(parsePostedAt(1_700_000_000, NOW)).toBe("2023-11-14T22:13:20.000Z");
    expect(parsePostedAt(1_700_000_000_000, NOW)).toBe("2023-11-14T22:13:20.000Z");
    expect(parsePostedAt("1700000000", NOW)).toBe("2023-11-14T22:13:20.000Z");
  });

  it("reads English relative text against the fetch time", () => {
    expect(parsePostedAt("Posted 3 Days Ago", NOW)).toBe("2026-11-18T10:00:00.000Z");
    expect(parsePostedAt("Posted Today", NOW)).toBe(NOW.toISOString());
    expect(parsePostedAt("Posted Yesterday", NOW)).toBe("2026-11-20T10:00:00.000Z");
    expect(parsePostedAt("2 weeks ago", NOW)).toBe("2026-11-07T10:00:00.000Z");
    expect(parsePostedAt("5 hours ago", NOW)).toBe("2026-11-21T05:00:00.000Z");
  });

  it("reads English month-day-year dates as midnight UTC", () => {
    expect(parsePostedAt("November 16, 2026", NOW)).toBe("2026-11-16T00:00:00.000Z");
    expect(parsePostedAt("November  4, 2026", NOW)).toBe("2026-11-04T00:00:00.000Z");
    expect(parsePostedAt("Nov 4, 2026", NOW)).toBe("2026-11-04T00:00:00.000Z");
  });

  it("returns null for open-ended, empty or unparseable values", () => {
    expect(parsePostedAt("Posted 30+ Days Ago", NOW)).toBeNull();
    expect(parsePostedAt("", NOW)).toBeNull();
    expect(parsePostedAt("soon", NOW)).toBeNull();
    expect(parsePostedAt("2026-13-45", NOW)).toBeNull();
    expect(parsePostedAt(null, NOW)).toBeNull();
    expect(parsePostedAt(Number.NaN, NOW)).toBeNull();
  });
});

describe("localDateString", () => {
  it("formats the local calendar date as YYYY-MM-DD", () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("toSnippet", () => {
  it("strips tags, decodes entities and collapses whitespace", () => {
    expect(toSnippet("<p>Build&nbsp;bots</p>\n<ul><li>A &amp; B</li></ul>")).toBe(
      "Build bots A & B",
    );
  });

  it("drops script and style content", () => {
    expect(toSnippet("<style>p{color:red}</style>Hello<script>alert(1)</script>")).toBe("Hello");
  });

  it("cuts at a word boundary within the default limit", () => {
    const snippet = toSnippet("word ".repeat(5000));

    expect(snippet.length).toBeLessThanOrEqual(DESCRIPTION_SNIPPET_MAX);
    expect(snippet.endsWith("word")).toBe(true);
  });

  it("keeps a whole posting, so keywords late in a long description are still there", () => {
    const posting = `${"Company overview. ".repeat(100)}We build Dialogflow CX agents.`;

    expect(posting.length).toBeGreaterThan(1000);
    expect(toSnippet(posting)).toBe(posting);
  });

  it("returns an empty string for empty input", () => {
    expect(toSnippet("")).toBe("");
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeHtmlEntities("&lt;p&gt; &#8211; &#x2014; &bogus; &amp;amp;")).toBe(
      "<p> – — &bogus; &amp;",
    );
  });

  it("leaves invalid code points as they are", () => {
    expect(decodeHtmlEntities("&#99999999;")).toBe("&#99999999;");
  });
});

describe("makeJobId", () => {
  it("is a stable 16 hex character id per company and external id", () => {
    expect(makeJobId("acme", "123")).toMatch(/^[0-9a-f]{16}$/);
    expect(makeJobId("acme", "123")).toBe(makeJobId("acme", "123"));
    expect(makeJobId("acme", "123")).not.toBe(makeJobId("other", "123"));
    expect(makeJobId("acme", "123")).not.toBe(makeJobId("acme", "124"));
  });
});

describe("mapWithConcurrency", () => {
  it("never exceeds the limit and keeps result order", async () => {
    let running = 0;
    let peak = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, (value: number) => Promise.resolve(value))).toEqual([]);
  });
});
