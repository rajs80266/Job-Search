import type { ImportCurlResponse } from "@server/types";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECIPE_KEYWORDS,
  buildRecipe,
  formFromImport,
  parseKeywords,
  slugify,
  type DraftForm,
} from "../src/lib/recipe-draft";

function imported(overrides: Partial<ImportCurlResponse["draft"]> = {}): ImportCurlResponse {
  return {
    draft: {
      ats: "workday",
      fetch: {
        url: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
        method: "POST",
      },
      status: "unverified",
      ...overrides,
    },
    strippedHeaders: ["cookie"],
    detectedAts: "workday",
    warnings: [],
  };
}

const filledForm = (overrides: Partial<DraftForm> = {}): DraftForm => ({
  ...formFromImport(imported()),
  name: " Acme Corp ",
  slug: "acme-corp",
  category: "cx-vendor",
  careersUrl: " https://acme.example/careers ",
  ...overrides,
});

describe("slugify", () => {
  it.each([
    ["Acme Corp", "acme-corp"],
    ["  Zoho  Corporation! ", "zoho-corporation"],
    ["Société Générale", "societe-generale"],
    ["!!!", ""],
  ])("%s -> %s", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });
});

describe("parseKeywords", () => {
  it("splits on commas, trims and drops blanks", () => {
    expect(parseKeywords(" CCAI, ,Dialogflow ,")).toEqual(["CCAI", "Dialogflow"]);
  });
});

describe("formFromImport", () => {
  it("prefills the standard keywords and the request JSON for an ATS adapter", () => {
    const form = formFromImport(
      imported({ name: "Acme", category: "bpo", careersUrl: "https://a.example/c" }),
    );

    expect(form).toMatchObject({
      name: "Acme",
      category: "bpo",
      careersUrl: "https://a.example/c",
      ats: "workday",
      keywords: DEFAULT_RECIPE_KEYWORDS.join(", "),
      fieldMapJson: "",
    });
    expect(JSON.parse(form.fetchJson)).toMatchObject({ method: "POST" });
  });

  it("gives the generic adapter no keywords and a field map template", () => {
    const form = formFromImport(imported({ ats: "generic" }));

    expect(form.keywords).toBe("");
    expect(JSON.parse(form.fieldMapJson)).toHaveProperty("externalId");
  });
});

describe("buildRecipe", () => {
  it("builds an unverified recipe from the form", () => {
    const built = buildRecipe(
      filledForm({ keywords: "CCAI, Dialogflow", location: " in ", indiaFiltered: true }),
    );

    expect(built).toEqual({
      recipe: {
        slug: "acme-corp",
        name: "Acme Corp",
        category: "cx-vendor",
        careersUrl: "https://acme.example/careers",
        ats: "workday",
        fetch: {
          url: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
          method: "POST",
        },
        filters: { keywords: ["CCAI", "Dialogflow"], location: "in", indiaFiltered: true },
        status: "unverified",
      },
    });
  });

  it("includes the field map only for the generic adapter, without blank placeholders", () => {
    const form = filledForm({
      ats: "generic",
      keywords: "",
      fieldMapJson: JSON.stringify({
        jobsPath: "",
        externalId: "id",
        title: "name",
        url: "",
        location: "",
      }),
    });

    const built = buildRecipe(form);

    expect(built).toMatchObject({
      recipe: { fieldMap: { jobsPath: "", externalId: "id", title: "name" } },
    });
    expect(JSON.stringify(built)).not.toContain('"location":""');
    expect(buildRecipe(filledForm({ fieldMapJson: '{"x":1}' }))).not.toHaveProperty(
      "recipe.fieldMap",
    );
  });

  it.each([
    ["invalid request JSON", { fetchJson: "{ nope" }, "Request (fetch) is not valid JSON"],
    ["a request that is an array", { fetchJson: "[]" }, "must be a JSON object"],
    ["too many keywords", { keywords: "a,b,c,d,e,f,g" }, "at most 6"],
    [
      "an invalid field map",
      { ats: "generic" as const, fieldMapJson: "nope" },
      "Field map is not valid JSON",
    ],
  ])("reports %s", (_name, overrides, message) => {
    const built = buildRecipe(filledForm(overrides));

    expect(built).toHaveProperty("error");
    expect((built as { error: string }).error).toContain(message);
  });
});
