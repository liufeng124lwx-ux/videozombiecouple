import { describe, expect, it } from "vitest";
import { ERROR_CHARGE, ERROR_CODES, errorBody, isErrorCode } from "../src/index.ts";

describe("error codes", () => {
  it("include every code from spec 3.6", () => {
    for (const code of [
      "FILE_UNSUPPORTED",
      "FILE_TOO_LARGE",
      "QUOTA_EXHAUSTED",
      "CREDITS_LOW",
      "CONTENT_REJECTED",
      "TIMEOUT",
      "PROVIDER_DOWN",
      "RATE_LIMITED",
      "FREE_TIER_PAUSED",
      "RETRY_NOT_ALLOWED",
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it("refund the user when the model side fails (spec 3.6)", () => {
    expect(ERROR_CHARGE.CONTENT_REJECTED).toBe("refunded");
    expect(ERROR_CHARGE.TIMEOUT).toBe("refunded");
    expect(ERROR_CHARGE.PROVIDER_DOWN).toBe("refunded");
    expect(ERROR_CHARGE.FILE_TOO_LARGE).toBe("not_charged");
  });

  it("build the response body with the request id", () => {
    expect(errorBody("RATE_LIMITED", "req-1", { retryAfterSec: 24 })).toEqual({
      error: { code: "RATE_LIMITED", requestId: "req-1", retryAfterSec: 24 },
    });
  });

  it("recognise known codes only", () => {
    expect(isErrorCode("TIMEOUT")).toBe(true);
    expect(isErrorCode("OOPS")).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it("include the sign-in codes", () => {
    for (const code of [
      "CODE_INVALID",
      "CODE_EXPIRED",
      "INVALID_CREDENTIALS",
      "EMAIL_REJECTED",
      "WEAK_PASSWORD",
    ]) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_CHARGE[code as keyof typeof ERROR_CHARGE]).toBe("none");
    }
  });

  it("never charges for a pause or a reached daily limit (cost guardrails spec 7)", () => {
    expect(ERROR_CHARGE.PAUSED).toBe("not_charged");
    expect(ERROR_CHARGE.DAILY_LIMIT).toBe("not_charged");
  });
});
