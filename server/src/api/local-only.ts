import type { RequestHandler } from "express";
import { ApiHttpError } from "./errors";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rejects DNS-rebinding requests (unexpected Host). */
export const requireLocalHost: RequestHandler = (req, _res, next) => {
  if (!LOCAL_HOSTNAMES.has(req.hostname)) {
    next(new ApiHttpError(403, "forbidden", `Host "${req.hostname}" is not allowed`));
    return;
  }
  next();
};

/** Blocks cross-site simple-form posts: browsers cannot send JSON content types without CORS. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const isJson = /^application\/json\b/i.test(req.get("content-type") ?? "");
  if (BODY_METHODS.has(req.method) && !isJson) {
    next(new ApiHttpError(400, "validation", "Content-Type must be application/json"));
    return;
  }
  next();
};
