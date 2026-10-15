export const ERROR_CODES = [
  "FILE_UNSUPPORTED",
  "FILE_TOO_LARGE",
  "QUOTA_EXHAUSTED",
  "CREDITS_LOW",
  "CONTENT_REJECTED",
  "TIMEOUT",
  "PROVIDER_DOWN",
  "RATE_LIMITED",
  "FREE_TIER_PAUSED",
  "PAUSED",
  "DAILY_LIMIT",
  "RETRY_NOT_ALLOWED",
  "CHALLENGE_REQUIRED",
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CODE_INVALID",
  "CODE_EXPIRED",
  "INVALID_CREDENTIALS",
  "EMAIL_REJECTED",
  "WEAK_PASSWORD",
  "SUBSCRIPTION_ACTIVE",
  "PAYMENTS_UNAVAILABLE",
  "PREVIEW_QUOTA_EXHAUSTED",
  "LOGIN_REQUIRED",
  "REMAKE_USED",
  "PHOTOS_EXPIRED",
  "NOT_READY",
  "RECOMPOSE_USED",
  "FACE_NOT_FOUND",
  "UNDERAGE",
  "PHOTO_REJECTED",
  "COMPOSE_FAILED",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** What an error means for the user's quota or credits (spec 3.6). */
export type ChargeEffect = "not_charged" | "refunded" | "none";

export const ERROR_CHARGE: Record<ErrorCode, ChargeEffect> = {
  FILE_UNSUPPORTED: "not_charged",
  FILE_TOO_LARGE: "not_charged",
  QUOTA_EXHAUSTED: "none",
  CREDITS_LOW: "none",
  CONTENT_REJECTED: "refunded",
  TIMEOUT: "refunded",
  PROVIDER_DOWN: "refunded",
  RATE_LIMITED: "not_charged",
  FREE_TIER_PAUSED: "not_charged",
  PAUSED: "not_charged",
  DAILY_LIMIT: "not_charged",
  RETRY_NOT_ALLOWED: "none",
  CHALLENGE_REQUIRED: "not_charged",
  BAD_REQUEST: "not_charged",
  UNAUTHORIZED: "none",
  FORBIDDEN: "none",
  NOT_FOUND: "none",
  CODE_INVALID: "none",
  CODE_EXPIRED: "none",
  INVALID_CREDENTIALS: "none",
  EMAIL_REJECTED: "none",
  WEAK_PASSWORD: "none",
  SUBSCRIPTION_ACTIVE: "none",
  PAYMENTS_UNAVAILABLE: "none",
  PREVIEW_QUOTA_EXHAUSTED: "none",
  LOGIN_REQUIRED: "none",
  REMAKE_USED: "none",
  PHOTOS_EXPIRED: "none",
  NOT_READY: "not_charged",
  RECOMPOSE_USED: "none",
  FACE_NOT_FOUND: "refunded",
  UNDERAGE: "refunded",
  PHOTO_REJECTED: "refunded",
  COMPOSE_FAILED: "refunded",
  INTERNAL: "refunded",
};

export type ErrorBody = {
  error: { code: ErrorCode; requestId: string; retryAfterSec?: number };
};

export function errorBody(
  code: ErrorCode,
  requestId: string,
  extra: { retryAfterSec?: number } = {},
): ErrorBody {
  return { error: { code, requestId, ...extra } };
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}
