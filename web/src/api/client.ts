import type { ApiError as ApiErrorBody } from "@server/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const UNREACHABLE_MESSAGE = "Cannot reach the API server. Is `npm run dev` running?";
/** What the Vite proxy answers when the API behind it is down. */
const UNREACHABLE_STATUSES = new Set([502, 503, 504]);

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: method === "GET" ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, UNREACHABLE_MESSAGE);
  }

  if (!response.ok) {
    if (UNREACHABLE_STATUSES.has(response.status)) throw new ApiError(0, UNREACHABLE_MESSAGE);
    const error = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null;
    throw new ApiError(
      response.status,
      error?.message ??
        `The server answered ${response.status} for ${method} ${path.split("?")[0]}`,
      error?.details,
    );
  }
  return (await response.json()) as T;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>("GET", path);

export const apiSend = <T>(
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown = {},
): Promise<T> => request<T>(method, path, body);
