import { describe, expect, it } from "vitest";
import { HTTP_USER_AGENT } from "../../src/config";
import { HttpError, createHttpClient } from "../../src/lib/http";

interface RecordedCall {
  url: string;
  init: RequestInit;
  at: number;
}

function setup(responses: (() => Response | Promise<Response>)[], timeoutMs = 15_000) {
  let clock = 0;
  const sleeps: number[] = [];
  const calls: RecordedCall[] = [];
  let next = 0;

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {}, at: clock });
    const respond = responses[Math.min(next++, responses.length - 1)];
    if (!respond) throw new Error("no response configured");
    return respond();
  }) as typeof fetch;

  const client = createHttpClient({
    fetchImpl,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    random: () => 0,
    timeoutMs,
  });
  return { client, calls, sleeps };
}

const ok =
  (body = "{}") =>
  () =>
    new Response(body, { status: 200 });
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response("nope", { status: code, headers });

describe("createHttpClient", () => {
  it("sends a browser-like user agent and no cookies", async () => {
    const { client, calls } = setup([ok()]);

    await client.request({
      url: "https://a.example/jobs",
      headers: { Cookie: "secret=1", "X-Test": "1" },
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe(HTTP_USER_AGENT);
    expect(headers["x-test"]).toBe("1");
    expect(headers["cookie"]).toBeUndefined();
    expect(calls[0]?.init.credentials).toBe("omit");
  });

  it("sends JSON bodies for POST and parses JSON responses", async () => {
    const { client, calls } = setup([ok('{"total":3}')]);

    const response = await client.request({
      url: "https://a.example/jobs",
      method: "POST",
      body: { limit: 20 },
    });

    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe('{"limit":20}');
    expect((calls[0]?.init.headers as Record<string, string>)["content-type"]).toBe(
      "application/json",
    );
    expect(response.json<{ total: number }>().total).toBe(3);
  });

  it("spaces request starts per host by the rate limit and does not delay other hosts", async () => {
    const startedAt = new Map<string, number[]>();
    const client = createHttpClient({
      fetchImpl: ((url: string) => {
        const host = new URL(url).hostname;
        startedAt.set(host, [...(startedAt.get(host) ?? []), Date.now()]);
        return Promise.resolve(new Response("{}"));
      }) as typeof fetch,
      rateLimitMs: 60,
    });

    const begin = Date.now();
    await Promise.all([
      client.request({ url: "https://a.example/1" }),
      client.request({ url: "https://a.example/2" }),
      client.request({ url: "https://a.example/3" }),
      client.request({ url: "https://b.example/1" }),
    ]);

    const [first = 0, second = 0, third = 0] = startedAt.get("a.example") ?? [];
    expect(second - first).toBeGreaterThanOrEqual(55);
    expect(third - second).toBeGreaterThanOrEqual(55);
    expect((startedAt.get("b.example")?.[0] ?? Infinity) - begin).toBeLessThan(40);
  });

  it("retries 5xx with 1 s then 3 s backoff and returns the first success", async () => {
    const { client, calls, sleeps } = setup([status(503), status(500), ok("done")]);

    const response = await client.request({ url: "https://a.example/jobs" });

    expect(response.text).toBe("done");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 3000]);
  });

  it("gives up after two retries and throws an HttpError with the status", async () => {
    const { client, calls } = setup([status(502)]);

    const failure = client.request({ url: "https://a.example/jobs" });

    await expect(failure).rejects.toMatchObject({ name: "HttpError", status: 502 });
    expect(calls).toHaveLength(3);
  });

  it("retries network errors", async () => {
    const { client, calls } = setup([
      () => {
        throw new TypeError("fetch failed");
      },
      ok("recovered"),
    ]);

    const response = await client.request({ url: "https://a.example/jobs" });

    expect(response.text).toBe("recovered");
    expect(calls).toHaveLength(2);
  });

  it("does not retry other 4xx responses", async () => {
    const { client, calls } = setup([status(404)]);

    await expect(client.request({ url: "https://a.example/jobs" })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(calls).toHaveLength(1);
  });

  it("honours Retry-After on 429 but caps it at 10 s", async () => {
    const { client, sleeps } = setup([
      status(429, { "retry-after": "2" }),
      status(429, { "retry-after": "120" }),
      ok(),
    ]);

    await client.request({ url: "https://a.example/jobs" });

    expect(sleeps).toEqual([2000, 10_000]);
  });

  it("times out a hanging request", async () => {
    const client = createHttpClient({
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
      sleep: () => Promise.resolve(),
      retryBackoffMs: [],
      timeoutMs: 20,
    });

    await expect(client.request({ url: "https://a.example/slow" })).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining("timed out after 20 ms") as unknown,
    });
  });

  it("stops immediately when the caller aborts", async () => {
    const { client, calls } = setup([ok()]);
    const controller = new AbortController();
    controller.abort(new Error("budget exceeded"));

    await expect(
      client.request({ url: "https://a.example/jobs", signal: controller.signal }),
    ).rejects.toThrow("budget exceeded");
    expect(calls).toHaveLength(0);
  });

  it("rejects responses over 5 MB", async () => {
    const { client } = setup([() => new Response("x".repeat(5 * 1024 * 1024 + 1))]);

    await expect(client.request({ url: "https://a.example/big" })).rejects.toThrow(/too large/);
  });
});
