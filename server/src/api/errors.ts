import type { ErrorRequestHandler, RequestHandler } from "express";
import type { z } from "zod";
import { formatZodIssues } from "../lib/zod-error";
import type { ApiError } from "../types";

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError["error"],
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

export function notFound(message: string): ApiHttpError {
  return new ApiHttpError(404, "not-found", message);
}

export function conflict(message: string, details?: unknown): ApiHttpError {
  return new ApiHttpError(409, "conflict", message, details);
}

export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiHttpError(400, "validation", formatZodIssues(result.error), result.error.issues);
  }
  return result.data;
}

export const unknownApiRoute: RequestHandler = (req) => {
  throw notFound(`No route for ${req.method} ${req.path}`);
};

const hasStatus = (error: unknown): error is { status: number } =>
  typeof error === "object" &&
  error !== null &&
  typeof (error as { status?: unknown }).status === "number";

export const apiErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiHttpError) {
    const body: ApiError = { error: error.code, message: error.message, details: error.details };
    res.status(error.status).json(body);
    return;
  }
  // express.json() reports a malformed body as a 400 with its own error type.
  if (hasStatus(error) && error.status === 400) {
    const body: ApiError = { error: "validation", message: "Request body is not valid JSON" };
    res.status(400).json(body);
    return;
  }

  console.error(error);
  const body: ApiError = { error: "internal", message: "Unexpected server error" };
  res.status(500).json(body);
};
