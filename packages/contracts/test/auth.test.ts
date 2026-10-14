import { describe, expect, it } from "vitest";
import {
  CodeLoginSchema,
  DeleteAccountSchema,
  EmailLoginSchema,
  isSameSitePath,
  LinkLoginSchema,
  SetPasswordSchema,
} from "../src/index.ts";

describe("auth schemas", () => {
  it("normalise emails to trimmed lower case", () => {
    expect(EmailLoginSchema.parse({ email: "  Ann@Example.COM " }).email).toBe("ann@example.com");
    expect(EmailLoginSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("accept six-digit codes and 64-hex link tokens only", () => {
    expect(CodeLoginSchema.safeParse({ email: "a@b.co", code: "012345" }).success).toBe(true);
    expect(CodeLoginSchema.safeParse({ email: "a@b.co", code: "12345" }).success).toBe(false);
    expect(LinkLoginSchema.safeParse({ token: "a".repeat(64) }).success).toBe(true);
    expect(LinkLoginSchema.safeParse({ token: "A".repeat(64) }).success).toBe(false);
  });

  it("want passwords of 8 to 128 characters", () => {
    expect(SetPasswordSchema.safeParse({ password: "1234567" }).success).toBe(false);
    expect(SetPasswordSchema.safeParse({ password: "12345678" }).success).toBe(true);
    expect(SetPasswordSchema.safeParse({ password: "x".repeat(129) }).success).toBe(false);
  });

  it("need the word DELETE to delete an account", () => {
    expect(DeleteAccountSchema.safeParse({ confirm: "DELETE" }).success).toBe(true);
    expect(DeleteAccountSchema.safeParse({ confirm: "delete" }).success).toBe(false);
  });
});

describe("isSameSitePath (open-redirect guard shared by web and API)", () => {
  it("accepts plain same-site paths", () => {
    expect(isSameSitePath("/pricing?buy=pack60")).toBe(true);
    expect(isSameSitePath("/account")).toBe(true);
  });

  it("rejects other sites, protocol-relative and backslash tricks", () => {
    for (const bad of [
      "//evil.com",
      "/\\evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "",
      "/a b",
    ])
      expect(isSameSitePath(bad), bad).toBe(false);
    expect(isSameSitePath(`/${"a".repeat(200)}`)).toBe(false);
  });
});
