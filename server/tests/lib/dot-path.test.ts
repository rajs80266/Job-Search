import { describe, expect, it } from "vitest";
import { getPath, renderTemplate, replaceInStrings, setPath, toText } from "../../src/lib/dot-path";

describe("getPath", () => {
  const source = { data: { jobs: [{ id: 7, locations: [{ name: "Pune" }] }] }, flag: false };

  it("walks objects and array indexes", () => {
    expect(getPath(source, "data.jobs.0.id")).toBe(7);
    expect(getPath(source, "data.jobs.0.locations.0.name")).toBe("Pune");
  });

  it("returns the source for an empty path and undefined for missing steps", () => {
    expect(getPath(source, "")).toBe(source);
    expect(getPath(source, "data.missing.deeper")).toBeUndefined();
    expect(getPath(source, "flag.deeper")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
});

describe("setPath", () => {
  it("creates missing objects and overwrites non-objects on the way", () => {
    const body: Record<string, unknown> = { paging: 3 };

    setPath(body, "paging.offset", 40);
    setPath(body, "query.page", 2);

    expect(body).toEqual({ paging: { offset: 40 }, query: { page: 2 } });
  });
});

describe("toText", () => {
  it("renders strings, numbers and arrays, and ignores everything else", () => {
    expect(toText("  Pune ")).toBe("Pune");
    expect(toText(42)).toBe("42");
    expect(toText(["Pune", "", "Mumbai"])).toBe("Pune | Mumbai");
    expect(toText({ a: 1 })).toBe("");
    expect(toText(null)).toBe("");
    expect(toText(Number.NaN)).toBe("");
  });
});

describe("renderTemplate", () => {
  it("substitutes dot paths from the job object", () => {
    const job = { id: 123, meta: { slug: "dev" } };

    expect(renderTemplate("https://x.com/jobs/{{id}}/{{ meta.slug }}", job)).toBe(
      "https://x.com/jobs/123/dev",
    );
    expect(renderTemplate("https://x.com/{{missing}}", job)).toBe("https://x.com/");
  });
});

describe("replaceInStrings", () => {
  it("replaces the placeholder in nested strings without changing the original", () => {
    const body = { searchText: "{{keyword}}", filters: [{ q: "a {{keyword}} b" }], limit: 20 };

    expect(replaceInStrings(body, "{{keyword}}", "dialogflow")).toEqual({
      searchText: "dialogflow",
      filters: [{ q: "a dialogflow b" }],
      limit: 20,
    });
    expect(body.searchText).toBe("{{keyword}}");
  });
});
