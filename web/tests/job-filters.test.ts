import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIERS,
  hasActiveFilters,
  parseFilters,
  toApiQuery,
  toSearchParams,
} from "../src/lib/job-filters";

const parse = (query: string) => parseFilters(new URLSearchParams(query));

describe("parseFilters", () => {
  it("uses the default view for an empty URL", () => {
    expect(parse("")).toEqual({
      q: "",
      company: [],
      category: [],
      tier: [...DEFAULT_TIERS],
      city: "",
      status: "",
      isNew: false,
      india: "true",
      remote: false,
      includeClosed: false,
      sort: "relevance",
      page: 1,
      pageSize: 50,
    });
  });

  it("reads every filter and keeps tiers in a canonical order", () => {
    const filters = parse(
      "q=dialogflow&company=acme,beta&category=bpo,nonsense&tier=none,high&city=Pune&status=saved" +
        "&isNew=true&india=all&remote=true&includeClosed=true&sort=posted&page=3&pageSize=100",
    );

    expect(filters).toEqual({
      q: "dialogflow",
      company: ["acme", "beta"],
      category: ["bpo"],
      tier: ["high", "none"],
      city: "Pune",
      status: "saved",
      isNew: true,
      india: "all",
      remote: true,
      includeClosed: true,
      sort: "posted",
      page: 3,
      pageSize: 100,
    });
  });

  it.each([
    ["tier=urgent", "tier", [...DEFAULT_TIERS]],
    ["status=dreaming", "status", ""],
    ["india=maybe", "india", "true"],
    ["sort=random", "sort", "relevance"],
    ["page=0", "page", 1],
    ["page=abc", "page", 1],
    ["pageSize=-5", "pageSize", 50],
    ["pageSize=9999", "pageSize", 200],
  ] as const)("falls back to the default for %s", (query, key, expected) => {
    expect(parse(query)[key]).toEqual(expected);
  });
});

describe("toSearchParams", () => {
  it("writes nothing for the default view", () => {
    expect(toSearchParams(parse("")).toString()).toBe("");
  });

  it("round-trips a non-default view", () => {
    const query =
      "q=chatbot&company=acme&tier=high&city=Pune&status=none&isNew=true&india=false&sort=firstSeen&page=2&pageSize=25";

    expect(parse(toSearchParams(parse(query)).toString())).toEqual(parse(query));
  });

  it("keeps an explicit all-tiers choice", () => {
    const filters = { ...parse(""), tier: ["high", "medium", "low", "none"] as const };

    expect(parse(toSearchParams({ ...filters, tier: [...filters.tier] }).toString()).tier).toEqual([
      "high",
      "medium",
      "low",
      "none",
    ]);
  });
});

describe("toApiQuery", () => {
  it("always spells out the defaults the UI depends on", () => {
    const params = new URLSearchParams(toApiQuery(parse("")));

    expect(Object.fromEntries(params)).toEqual({
      tier: "high,medium,low",
      india: "true",
      includeClosed: "false",
      sort: "relevance",
      page: "1",
      pageSize: "50",
    });
  });

  it("sends only the filters that are set", () => {
    const params = new URLSearchParams(
      toApiQuery(parse("q=ccai&isNew=true&status=none&remote=true")),
    );

    expect(params.get("q")).toBe("ccai");
    expect(params.get("isNew")).toBe("true");
    expect(params.get("status")).toBe("none");
    expect(params.get("remote")).toBe("true");
    expect(params.has("city")).toBe(false);
  });
});

describe("hasActiveFilters", () => {
  it("is false for the default view and for sorting or paging only", () => {
    expect(hasActiveFilters(parse(""))).toBe(false);
    expect(hasActiveFilters(parse("sort=posted&page=4&pageSize=100"))).toBe(false);
    expect(hasActiveFilters(parse("tier=low,medium,high"))).toBe(false);
  });

  it.each(["q=x", "company=acme", "tier=high", "isNew=true", "india=all", "includeClosed=true"])(
    "is true for %s",
    (query) => {
      expect(hasActiveFilters(parse(query))).toBe(true);
    },
  );
});
