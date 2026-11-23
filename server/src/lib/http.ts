import {
  HTTP_MAX_JITTER_MS,
  HTTP_MAX_RESPONSE_BYTES,
  HTTP_MAX_RETRY_AFTER_MS,
  HTTP_RATE_LIMIT_MS,
  HTTP_RETRY_BACKOFF_MS,
  HTTP_TIMEOUT_MS,
  HTTP_USER_AGENT,
} from "../config";
import type { HttpClient, HttpRequest, HttpResponse } from "../types";

export class HttpError extends Error {
  /** HTTP status, or 0 when no response arrived (network error, timeout). */
  readonly status: number;
  readonly url: string;
  readonly retryAfterMs: number | null;

  constructor(message: string, status: number, url: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface HttpClientOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  rateLimitMs?: number;
  timeoutMs?: number;
  /** Delay before each retry; its length is the number of retries. */
  retryBackoffMs?: readonly number[];
}

const NEVER_SENT_HEADERS = new Set(["cookie", "cookie2"]);

function isRetryable(error: HttpError): boolean {
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function buildHeaders(req: HttpRequest): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": HTTP_USER_AGENT,
    accept: "application/json, text/html;q=0.9, */*;q=0.8",
  };
  if (req.body !== undefined) headers["content-type"] = "application/json";
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    const lowerName = name.toLowerCase();
    if (!NEVER_SENT_HEADERS.has(lowerName)) headers[lowerName] = value;
  }
  return headers;
}

function toResponse(status: number, url: string, text: string): HttpResponse {
  return { status, url, text, json: <T>() => JSON.parse(text) as T };
}

/**
 * One instance shares the per-host rate limit, so create it once per process.
 * Never sends cookies and keeps none between requests.
 */
export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const rateLimitMs = options.rateLimitMs ?? HTTP_RATE_LIMIT_MS;
  const timeoutMs = options.timeoutMs ?? HTTP_TIMEOUT_MS;
  const retryBackoffMs = options.retryBackoffMs ?? HTTP_RETRY_BACKOFF_MS;

  const nextFreeSlotByHost = new Map<string, number>();

  /** Reserves the next start time for the host synchronously, so concurrent callers queue up. */
  async function waitForSlot(host: string): Promise<void> {
    const current = now();
    const start = Math.max(current, nextFreeSlotByHost.get(host) ?? 0);
    nextFreeSlotByHost.set(host, start + rateLimitMs);
    if (start > current) await sleep(start - current);
  }

  async function attempt(req: HttpRequest): Promise<HttpResponse> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;

    try {
      const response = await fetchImpl(req.url, {
        method: req.method ?? "GET",
        headers: buildHeaders(req),
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        credentials: "omit",
        signal,
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new HttpError(
          `HTTP ${response.status} for ${req.url}`,
          response.status,
          req.url,
          parseRetryAfterMs(response.headers.get("retry-after")),
        );
      }

      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > HTTP_MAX_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new HttpError(`Response too large for ${req.url}`, response.status, req.url);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > HTTP_MAX_RESPONSE_BYTES) {
        throw new HttpError(`Response too large for ${req.url}`, response.status, req.url);
      }
      return toResponse(response.status, response.url || req.url, new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (req.signal?.aborted) throw error;
      const reason = timeout.aborted ? `timed out after ${timeoutMs} ms` : errorMessage(error);
      throw new HttpError(`Request failed for ${req.url}: ${reason}`, 0, req.url);
    }
  }

  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      const host = new URL(req.url).hostname;

      for (let attemptIndex = 0; ; attemptIndex++) {
        req.signal?.throwIfAborted();
        await waitForSlot(host);
        try {
          return await attempt(req);
        } catch (error) {
          const backoff = retryBackoffMs[attemptIndex];
          if (!(error instanceof HttpError) || !isRetryable(error) || backoff === undefined) {
            throw error;
          }
          const delay =
            error.retryAfterMs === null
              ? backoff
              : Math.min(error.retryAfterMs, HTTP_MAX_RETRY_AFTER_MS);
          await sleep(delay + random() * HTTP_MAX_JITTER_MS);
        }
      }
    },
  };
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}
