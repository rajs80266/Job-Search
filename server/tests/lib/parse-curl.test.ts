import { describe, expect, it } from "vitest";
import { ParseRequestError, parseRequestText, tokenizeShell } from "../../src/lib/parse-curl";
import { readFixture } from "../helpers";

describe("tokenizeShell", () => {
  it("handles single, double and ANSI-C quotes and line continuations", () => {
    expect(tokenizeShell(`curl 'a b' "c \\"d\\"" $'e\\nf\\u00fc\\'g' \\\n  plain`)).toEqual([
      "curl",
      "a b",
      'c "d"',
      "e\nfü'g",
      "plain",
    ]);
  });

  it("keeps an empty quoted word", () => {
    expect(tokenizeShell("curl ''")).toEqual(["curl", ""]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => tokenizeShell("curl 'oops")).toThrow(ParseRequestError);
  });
});

describe("parseRequestText: cURL", () => {
  it("keeps a JSON POST body and only the three safe headers, and lists the rest by name", () => {
    const parsed = parseRequestText(readFixture("curl/workday-bash.txt"));

    expect(parsed).toMatchObject({
      url: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-language": "en-US",
        "content-type": "application/json",
      },
      body: {
        appliedFacets: { locationCountry: ["c4f78be1a8f14da0ab49ce1162348a5e"] },
        limit: 20,
        offset: 0,
        searchText: "",
      },
      referer: "https://acme.wd3.myworkdayjobs.com/External",
      warnings: [],
    });
    expect(parsed.strippedHeaders).toEqual([
      "cookie",
      "origin",
      "referer",
      "sec-ch-ua",
      "user-agent",
      "x-calypso-csrf-token",
    ]);
  });

  it("never lets a secret value out, in any field", () => {
    const parsed = JSON.stringify(parseRequestText(readFixture("curl/workday-bash.txt")));

    expect(parsed).not.toMatch(/SECRET|PLAY_SESSION|abc123/);
  });

  it("treats -b and authorization as credentials and warns about secret-looking query parameters", () => {
    const parsed = parseRequestText(readFixture("curl/lever-ansi.txt"));

    expect(parsed.method).toBe("GET");
    expect(parsed.strippedHeaders).toEqual(["authorization", "cookie"]);
    expect(parsed.warnings.join(" ")).toContain("token");
    expect(JSON.stringify(parsed)).not.toMatch(/SECRET-BEARER|session=abc/);
  });

  it("decodes $'...' bodies with escapes", () => {
    const parsed = parseRequestText(readFixture("curl/generic-ansi.txt"));

    expect(parsed.method).toBe("POST");
    expect(parsed.body).toEqual({ keyword: "it's", note: "line1\nline2", city: "Zürich" });
  });

  it("leaves out a body that is not a JSON object, with a warning", () => {
    const parsed = parseRequestText("curl 'https://x.example/api' --data-raw 'a=1&b=2'");

    expect(parsed.method).toBe("POST");
    expect(parsed.body).toBeUndefined();
    expect(parsed.warnings[0]).toContain("not a JSON object");
  });

  it("drops a body on a GET with a warning", () => {
    const parsed = parseRequestText(`curl -X GET 'https://x.example/api' --data-raw '{"a":1}'`);

    expect(parsed.body).toBeUndefined();
    expect(parsed.warnings[0]).toContain("GET");
  });

  it.each([
    ["curl -X DELETE 'https://x.example/api'", "DELETE"],
    ["curl -X PUT 'https://x.example/api'", "PUT"],
  ])("rejects unsupported methods: %s", (command, method) => {
    expect(() => parseRequestText(command)).toThrow(method);
  });

  it.each([
    ["hello world", "Copy as cURL"],
    ["curl 'not a url'", "absolute URL"],
    ["curl 'ftp://x.example/a'", "http(s)"],
    ["curl", "absolute URL"],
  ])("rejects %s", (text, message) => {
    expect(() => parseRequestText(text)).toThrow(message);
  });
});

describe("parseRequestText: fetch", () => {
  it("reads Chrome's Copy as fetch", () => {
    const parsed = parseRequestText(readFixture("curl/workday-fetch.txt"));

    expect(parsed).toMatchObject({
      url: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs",
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json",
      },
      body: { appliedFacets: {}, limit: 20, offset: 0, searchText: "" },
      referer: "https://acme.wd3.myworkdayjobs.com/External",
    });
    expect(parsed.strippedHeaders).toEqual(["sec-fetch-mode", "x-csrf-token"]);
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
  });

  it("reads a GET fetch without options", () => {
    const parsed = parseRequestText(`fetch("https://api.lever.co/v0/postings/meesho?mode=json");`);

    expect(parsed).toMatchObject({ method: "GET", headers: {}, strippedHeaders: [] });
  });

  it("rejects options that are not JSON", () => {
    expect(() => parseRequestText(`fetch("https://x.example/a", { headers: { a: b } })`)).toThrow(
      "not plain JSON",
    );
  });
});
