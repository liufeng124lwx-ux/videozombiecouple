import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../src/services/password.ts";
import { setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("wrong horse", stored)).toBe(false);
    expect(await verifyPassword("correct horse", "garbage")).toBe(false);
  });
});

describe("password sign-in (spec 5.1)", () => {
  async function withPassword() {
    const h = await setup();
    const { session } = await h.signIn("ann@example.com");
    const set = await h.call("/v1/account/password", {
      method: "POST",
      body: { password: "correct horse" },
      session,
    });
    expect(set.status).toBe(200);
    const login = (email: string, password: string) =>
      h.call("/v1/auth/password", { method: "POST", body: { email, password } });
    return { h, session, login };
  }

  it("signs in with the password set on the account page", async () => {
    const { h, login } = await withPassword();
    const response = await login("Ann@Example.com", "correct horse");
    expect(response.status).toBe(200);
    const session = /upx_sess=([a-f0-9]{64})/.exec(response.headers.getSetCookie().join(";"))?.[1];
    expect((await h.call("/v1/me", { session })).body.user).toMatchObject({ hasPassword: true });
  });

  it("answers the same for a wrong password and an unknown email", async () => {
    const { login } = await withPassword();
    expect((await login("ann@example.com", "wrong")).body.error?.code).toBe("INVALID_CREDENTIALS");
    expect((await login("nobody@example.com", "x")).body.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("limits guesses to 10 an hour per email", async () => {
    const { login } = await withPassword();
    for (let i = 0; i < 10; i++) await login("ann@example.com", `wrong${i}`);
    expect((await login("ann@example.com", "correct horse")).status).toBe(429);
  });

  it("needs a session and a password of 8 or more characters to set one", async () => {
    const { h, session } = await withPassword();
    const anonymous = await h.call("/v1/account/password", {
      method: "POST",
      body: { password: "long enough" },
    });
    expect(anonymous.body.error?.code).toBe("UNAUTHORIZED");
    const weak = await h.call("/v1/account/password", {
      method: "POST",
      body: { password: "short" },
      session,
    });
    expect(weak.body.error?.code).toBe("WEAK_PASSWORD");
  });
});

// Final review: an unknown email skipped the 100k-round hash and answered much faster.
describe("password sign-in timing", () => {
  it("spends as long on an unknown email as on a wrong password", async () => {
    const h = await setup();
    const { session } = await h.signIn("ann@example.com");
    await h.call("/v1/account/password", {
      method: "POST",
      body: { password: "correct horse" },
      session,
    });
    // Count the PBKDF2 runs rather than timing them: wall-clock timing flakes under a busy suite.
    const derive = vi.spyOn(crypto.subtle, "deriveBits");
    const runs = async (email: string) => {
      derive.mockClear();
      await h.call("/v1/auth/password", {
        method: "POST",
        body: { email, password: "wrong guess" },
      });
      return derive.mock.calls.length;
    };
    await runs("nobody@example.com"); // the dummy hash is made once, on first use
    const known = await runs("ann@example.com");
    const unknown = await runs("nobody@example.com");
    derive.mockRestore();
    expect(known).toBeGreaterThan(0);
    expect(unknown).toBe(known);
  });
});
