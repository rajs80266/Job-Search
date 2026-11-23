function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads "a.b.0.c" from parsed JSON; "" returns the source itself. Missing steps give undefined. */
export function getPath(source: unknown, path: string): unknown {
  if (path === "") return source;

  let current = source;
  for (const key of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Writes "a.b.c" into `target`, creating missing objects on the way. */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  const lastKey = keys.pop();
  if (lastKey === undefined) return;

  let current = target;
  for (const key of keys) {
    const next = current[key];
    if (isRecord(next)) {
      current = next;
    } else {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    }
  }
  current[lastKey] = value;
}

/** Text for a JSON leaf: strings and numbers as is, arrays joined with " | ", anything else "". */
export function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    return value
      .map(toText)
      .filter((part) => part !== "")
      .join(" | ");
  }
  return "";
}

/** Replaces each `{{dot.path}}` with the text found at that path in `source`. */
export function renderTemplate(template: string, source: unknown): string {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, path: string) =>
    toText(getPath(source, path)),
  );
}

/** Deep copy of a JSON value with `placeholder` replaced inside every string. */
export function replaceInStrings<T>(value: T, placeholder: string, replacement: string): T {
  if (typeof value === "string") return value.split(placeholder).join(replacement) as T;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => replaceInStrings(item, placeholder, replacement)) as T;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceInStrings(item, placeholder, replacement),
      ]),
    ) as T;
  }
  return value;
}
