import { DESCRIPTION_SNIPPET_MAX } from "../types";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

function codePointToString(codePoint: number, original: string): string {
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return original;
  }
}

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return codePointToString(Number.parseInt(body.slice(2), 16), entity);
    }
    if (body.startsWith("#")) return codePointToString(Number.parseInt(body.slice(1), 10), entity);
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Plain text from listing HTML or text, whitespace collapsed, cut at a word boundary. */
export function toSnippet(htmlOrText: string, maxLength = DESCRIPTION_SNIPPET_MAX): string {
  const withoutTags = htmlOrText
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  const text = collapseWhitespace(decodeHtmlEntities(withoutTags));
  if (text.length <= maxLength) return text;

  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}
