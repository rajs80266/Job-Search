import type { Ats, CompanyCategory, ImportCurlResponse } from "@server/types";

/**
 * The same six keywords every researched recipe uses; they are only sent to ATSs that have a
 * keyword search (and not for the generic adapter, which needs {{keyword}} in its request).
 */
export const DEFAULT_RECIPE_KEYWORDS = [
  "Dialogflow",
  "Conversational AI",
  "CCAI",
  "Agent Assist",
  "CX Agent Studio",
  "GECX",
] as const;

export const MAX_RECIPE_KEYWORDS = 6;

export interface DraftForm {
  name: string;
  slug: string;
  slugEdited: boolean;
  category: CompanyCategory | "";
  careersUrl: string;
  ats: Ats;
  /** Comma-separated. */
  keywords: string;
  indiaFiltered: boolean;
  location: string;
  /** JSON text of recipe.fetch. */
  fetchJson: string;
  /** JSON text of recipe.fieldMap; used for the generic adapter only. */
  fieldMapJson: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseKeywords(text: string): string[] {
  return text
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

export const FIELD_MAP_TEMPLATE = JSON.stringify(
  { jobsPath: "", externalId: "", title: "", url: "", location: "" },
  null,
  2,
);

export function formFromImport(imported: ImportCurlResponse): DraftForm {
  const { draft } = imported;
  const isGeneric = draft.ats === "generic";
  return {
    name: draft.name ?? "",
    slug: draft.slug ?? "",
    slugEdited: Boolean(draft.slug),
    category: draft.category ?? "",
    careersUrl: draft.careersUrl ?? "",
    ats: draft.ats,
    keywords: isGeneric ? "" : DEFAULT_RECIPE_KEYWORDS.join(", "),
    indiaFiltered: false,
    location: "",
    fetchJson: JSON.stringify(draft.fetch, null, 2),
    fieldMapJson: isGeneric ? FIELD_MAP_TEMPLATE : "",
  };
}

export type BuiltRecipe = { recipe: Record<string, unknown>; error?: never } | { error: string };

function parseJsonObject(label: string, text: string): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return `${label} must be a JSON object`;
  } catch (error) {
    return `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Turns the form into the recipe the API validates. Only JSON syntax is checked here. */
export function buildRecipe(form: DraftForm): BuiltRecipe {
  const fetch = parseJsonObject("Request (fetch)", form.fetchJson);
  if (typeof fetch === "string") return { error: fetch };

  let fieldMap: Record<string, unknown> | undefined;
  if (form.ats === "generic") {
    const parsed = parseJsonObject("Field map", form.fieldMapJson);
    if (typeof parsed === "string") return { error: parsed };
    // Blank paths are the template's placeholders; leave them out so the API names the missing ones.
    // (An empty jobsPath is valid: it means the response itself is the list.)
    fieldMap = Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) => value !== "" || key === "jobsPath"),
    );
  }

  const keywords = parseKeywords(form.keywords);
  if (keywords.length > MAX_RECIPE_KEYWORDS) {
    return { error: `Use at most ${MAX_RECIPE_KEYWORDS} keywords (one query is sent per keyword)` };
  }

  return {
    recipe: {
      slug: form.slug,
      name: form.name.trim(),
      category: form.category,
      careersUrl: form.careersUrl.trim(),
      ats: form.ats,
      fetch,
      ...(fieldMap && { fieldMap }),
      filters: {
        keywords,
        ...(form.location.trim() && { location: form.location.trim() }),
        indiaFiltered: form.indiaFiltered,
      },
      status: "unverified",
    },
  };
}
