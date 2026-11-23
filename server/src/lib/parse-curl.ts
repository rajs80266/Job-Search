import { FORBIDDEN_HEADER_PATTERN } from "../types";

export interface ParsedRequest {
  url: string;
  method: "GET" | "POST";
  /** Only the headers worth keeping (see KEPT_HEADERS), lower-case names. */
  headers: Record<string, string>;
  /** Names (never values) of every header that was dropped, lower-case. */
  strippedHeaders: string[];
  /** Parsed JSON object body, if there is one. */
  body?: Record<string, unknown>;
  /** The page the browser was on, when the request carries one. */
  referer?: string;
  warnings: string[];
}

export class ParseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseRequestError";
  }
}

/** Everything else (cookies, tokens, user agent, sec-* hints, referer) is browser noise or a secret. */
const KEPT_HEADERS = new Set(["accept", "accept-language", "content-type"]);

interface RawRequest {
  url: string;
  method: string | null;
  headers: [name: string, value: string][];
  body: string | null;
  referer: string | null;
  /** Credential flags that carry no header, e.g. -b or -u. */
  credentialNames: string[];
}

const ANSI_ESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "\\": "\\",
  "'": "'",
  '"': '"',
};

/** Splits a bash command line into words: handles '...', "...", $'...' and line continuations. */
export function tokenizeShell(command: string): string[] {
  const text = command.replace(/\\\r?\n/g, " ");
  const tokens: string[] = [];
  let current = "";
  let inToken = false;
  let index = 0;

  const readAnsiC = (): void => {
    index += 2;
    while (index < text.length && text[index] !== "'") {
      const character = text[index] ?? "";
      if (character !== "\\") {
        current += character;
        index++;
        continue;
      }
      const next = text[index + 1] ?? "";
      const unicode = /^u([0-9a-fA-F]{4})/.exec(text.slice(index + 1, index + 6));
      const hex = /^x([0-9a-fA-F]{2})/.exec(text.slice(index + 1, index + 4));
      if (unicode?.[1]) {
        current += String.fromCharCode(parseInt(unicode[1], 16));
        index += 6;
      } else if (hex?.[1]) {
        current += String.fromCharCode(parseInt(hex[1], 16));
        index += 4;
      } else {
        current += ANSI_ESCAPES[next] ?? next;
        index += 2;
      }
    }
    index++;
  };

  while (index < text.length) {
    const character = text[index] ?? "";
    if (/\s/.test(character)) {
      if (inToken) tokens.push(current);
      current = "";
      inToken = false;
      index++;
    } else if (character === "$" && text[index + 1] === "'") {
      inToken = true;
      readAnsiC();
    } else if (character === "'") {
      inToken = true;
      const end = text.indexOf("'", index + 1);
      if (end === -1) throw new ParseRequestError("unterminated ' in the cURL command");
      current += text.slice(index + 1, end);
      index = end + 1;
    } else if (character === '"') {
      inToken = true;
      index++;
      while (index < text.length && text[index] !== '"') {
        if (text[index] === "\\" && /["\\$`]/.test(text[index + 1] ?? "")) index++;
        current += text[index] ?? "";
        index++;
      }
      if (text[index] !== '"') throw new ParseRequestError('unterminated " in the cURL command');
      index++;
    } else if (character === "\\" && index + 1 < text.length) {
      inToken = true;
      current += text[index + 1] ?? "";
      index += 2;
    } else {
      inToken = true;
      current += character;
      index++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

const DATA_FLAGS = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"]);
const FLAGS_WITH_IGNORED_VALUE = new Set([
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "--connect-timeout",
  "-m",
  "--max-time",
  "-o",
  "--output",
  "--proxy",
  "-x",
]);

function splitHeader(line: string): [string, string] | null {
  const colon = line.indexOf(":");
  if (colon <= 0) return null;
  return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
}

function parseCurl(command: string): RawRequest {
  const tokens = tokenizeShell(command);
  if (tokens[0] !== "curl") throw new ParseRequestError("not a curl command");

  const raw: RawRequest = {
    url: "",
    method: null,
    headers: [],
    body: null,
    referer: null,
    credentialNames: [],
  };

  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    const value = (): string => tokens[++index] ?? "";

    if (token === "-X" || token === "--request") raw.method = value().toUpperCase();
    else if (token === "-H" || token === "--header") {
      const header = splitHeader(value());
      if (header) raw.headers.push(header);
    } else if (DATA_FLAGS.has(token)) raw.body = value();
    else if (token === "--data-urlencode") raw.body = value();
    else if (token === "-b" || token === "--cookie") {
      value();
      raw.credentialNames.push("cookie");
    } else if (token === "-u" || token === "--user") {
      value();
      raw.credentialNames.push("authorization");
    } else if (token === "-e" || token === "--referer") raw.referer = value();
    else if (token === "-G" || token === "--get") raw.method = "GET";
    else if (FLAGS_WITH_IGNORED_VALUE.has(token)) value();
    else if (token === "--url") raw.url = value();
    else if (!token.startsWith("-") && raw.url === "") raw.url = token;
  }
  return raw;
}

interface FetchOptions {
  headers?: Record<string, unknown>;
  body?: unknown;
  method?: unknown;
  referrer?: unknown;
}

function parseFetch(command: string): RawRequest {
  const open = command.indexOf("fetch(");
  const close = command.lastIndexOf(")");
  if (open === -1 || close < open) throw new ParseRequestError("not a fetch(...) call");

  const args = command.slice(open + "fetch(".length, close).trim();
  const urlMatch =
    /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`]*)`)\s*(?:,\s*([\s\S]*))?$/.exec(args);
  if (!urlMatch) throw new ParseRequestError("could not read the URL of the fetch(...) call");

  const url = urlMatch[1] ?? urlMatch[2] ?? urlMatch[3] ?? "";
  const optionsText = (urlMatch[4] ?? "").trim().replace(/;\s*$/, "");
  let options: FetchOptions = {};
  if (optionsText) {
    try {
      options = JSON.parse(optionsText) as FetchOptions;
    } catch {
      throw new ParseRequestError(
        'the fetch options are not plain JSON (use Chrome\'s "Copy as fetch")',
      );
    }
  }

  return {
    url: url.replace(/\\(.)/g, "$1"),
    method: typeof options.method === "string" ? options.method.toUpperCase() : null,
    headers: Object.entries(options.headers ?? {}).map(([name, value]) => [name, String(value)]),
    body: typeof options.body === "string" ? options.body : null,
    referer: typeof options.referrer === "string" ? options.referrer : null,
    credentialNames: [],
  };
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function secretLookingQueryParams(url: URL): string[] {
  return [...url.searchParams.keys()].filter((name) => FORBIDDEN_HEADER_PATTERN.test(name));
}

/**
 * Reads a pasted "Copy as cURL (bash)" or "Copy as fetch" string. Pure: no network. Only
 * accept / accept-language / content-type headers survive; every other header is listed by
 * name in `strippedHeaders`.
 */
export function parseRequestText(text: string): ParsedRequest {
  const trimmed = text.trim();
  const raw = trimmed.startsWith("curl")
    ? parseCurl(trimmed)
    : trimmed.includes("fetch(")
      ? parseFetch(trimmed)
      : null;
  if (!raw) {
    throw new ParseRequestError(
      'expected a "Copy as cURL (bash)" or "Copy as fetch" string from the browser network tab',
    );
  }

  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    throw new ParseRequestError(`"${raw.url.slice(0, 80)}" is not an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ParseRequestError("only http(s) URLs are supported");
  }

  const warnings: string[] = [];
  const headers: Record<string, string> = {};
  const stripped = new Set(raw.credentialNames);
  let referer = raw.referer;
  for (const [name, value] of raw.headers) {
    const lowerName = name.toLowerCase();
    if (KEPT_HEADERS.has(lowerName)) headers[lowerName] = value;
    else {
      stripped.add(lowerName);
      if (lowerName === "referer") referer ??= value;
    }
  }

  let body: Record<string, unknown> | undefined;
  if (raw.body !== null && raw.body !== "") {
    body = parseJsonObject(raw.body) ?? undefined;
    if (!body) {
      warnings.push(
        "The request body is not a JSON object, so it was left out. Recipes only store JSON bodies.",
      );
    }
  }

  const method = raw.method ?? (raw.body === null ? "GET" : "POST");
  if (method !== "GET" && method !== "POST") {
    throw new ParseRequestError(
      `${method} requests are not supported; recipes read listings with GET or POST`,
    );
  }
  if (method === "GET" && body) {
    warnings.push("A GET request cannot have a body; the body was left out.");
    body = undefined;
  }

  const secretParams = secretLookingQueryParams(url);
  if (secretParams.length > 0) {
    warnings.push(
      `The URL has query parameter(s) that look like credentials (${secretParams.join(", ")}). Do not save a recipe that depends on a secret.`,
    );
  }

  return {
    url: url.toString(),
    method,
    headers,
    strippedHeaders: [...stripped].sort(),
    ...(body && { body }),
    ...(referer && { referer }),
    warnings,
  };
}
