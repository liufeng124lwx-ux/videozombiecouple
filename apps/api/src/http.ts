import { type ErrorCode, errorBody } from "@vzc/contracts";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./types.ts";

/** HTTP status for each error code when an API call itself fails. */
export const ERROR_STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  FILE_UNSUPPORTED: 422,
  FILE_TOO_LARGE: 413,
  QUOTA_EXHAUSTED: 402,
  CREDITS_LOW: 402,
  CONTENT_REJECTED: 422,
  TIMEOUT: 504,
  PROVIDER_DOWN: 503,
  RATE_LIMITED: 429,
  FREE_TIER_PAUSED: 503,
  PAUSED: 503,
  DAILY_LIMIT: 429,
  RETRY_NOT_ALLOWED: 409,
  CHALLENGE_REQUIRED: 403,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CODE_INVALID: 401,
  CODE_EXPIRED: 401,
  INVALID_CREDENTIALS: 401,
  EMAIL_REJECTED: 422,
  WEAK_PASSWORD: 400,
  SUBSCRIPTION_ACTIVE: 409,
  PAYMENTS_UNAVAILABLE: 503,
  PREVIEW_QUOTA_EXHAUSTED: 402,
  LOGIN_REQUIRED: 401,
  NOT_READY: 409,
  RECOMPOSE_USED: 409,
  REMAKE_USED: 409,
  PHOTOS_EXPIRED: 410,
  FACE_NOT_FOUND: 422,
  UNDERAGE: 422,
  COMPOSE_FAILED: 503,
  INTERNAL: 500,
};

export function fail(c: Context<AppEnv>, code: ErrorCode, retryAfterSec?: number): Response {
  if (retryAfterSec !== undefined) c.header("retry-after", String(retryAfterSec));
  const extra = retryAfterSec === undefined ? {} : { retryAfterSec };
  return c.json(errorBody(code, c.get("requestId"), extra), ERROR_STATUS[code]);
}
