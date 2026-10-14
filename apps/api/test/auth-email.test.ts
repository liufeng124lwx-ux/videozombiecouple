import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

const EMAIL = "ann@example.com";

async function ready() {
  const h = await setup();
  await h.pass();
  const ask = (email = EMAIL, next?: string) =>
    h.call("/v1/auth/email", { method: "POST", body: next ? { email, next } : { email } });
  const lastMail = () => h.mail[h.mail.length - 1];
  const codeOf = () => /\b(\d{6})\b/.exec(lastMail()?.subject ?? "")?.[1] ?? "";
  const tokenOf = () => /login=([a-f0-9]{64})/.exec(lastMail()?.text ?? "")?.[1] ?? "";
  const sessionOf = (headers: Headers) =>
    /upx_sess=([a-f0-9]{64})/.exec(headers.getSetCookie().join(";"))?.[1];
  return { h, ask, codeOf, tokenOf, sessionOf };
}

describe("email sign-in (spec 5.1)", () => {
  it("emails a 6-digit code and a link back to the page", async () => {
    const { h, ask, codeOf, tokenOf } = await ready();
    const response = await ask(EMAIL, "/unblur-photo?job=1");
    expect(response.status).toBe(202);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]?.to).toBe(EMAIL);
    expect(h.mail[0]?.from).toBe("VideoZombieCouple <no-reply@videozombiecouple.com>");
    expect(codeOf()).toMatch(/^\d{6}$/);
    expect(h.mail[0]?.text).toContain(
      `https://videozombiecouple.com/account?login=${tokenOf()}&next=%2Funblur-photo%3Fjob%3D1`,
    );
  });

  it("creates the account on the first code and signs in", async () => {
    const { h, ask, codeOf, sessionOf } = await ready();
    await ask();
    const response = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: codeOf() },
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, created: true });
    const session = sessionOf(response.headers);
    expect((await h.call("/v1/me", { session })).body.user).toMatchObject({ email: EMAIL });
  });

  it("signs in an existing account by link, once", async () => {
    const { h, ask, tokenOf, sessionOf } = await ready();
    const { userId } = await h.signIn(EMAIL);
    await ask();
    const token = tokenOf();
    const first = await h.call("/v1/auth/link", { method: "POST", body: { token } });
    expect(first.body).toEqual({ ok: true, created: false });
    expect((await h.call("/v1/me", { session: sessionOf(first.headers) })).body.user).toMatchObject(
      { id: userId },
    );
    const again = await h.call("/v1/auth/link", { method: "POST", body: { token } });
    expect(again.body.error?.code).toBe("CODE_EXPIRED");
  });

  it("voids the code after 5 wrong guesses and after 10 minutes", async () => {
    const { h, ask, codeOf } = await ready();
    await ask();
    const code = codeOf();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) {
      const r = await h.call("/v1/auth/code", {
        method: "POST",
        body: { email: EMAIL, code: wrong },
      });
      expect(r.body.error?.code).toBe("CODE_INVALID");
    }
    const fifth = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: wrong },
    });
    expect(fifth.body.error?.code).toBe("CODE_EXPIRED");
    const right = await h.call("/v1/auth/code", { method: "POST", body: { email: EMAIL, code } });
    expect(right.body.error?.code).toBe("CODE_EXPIRED");

    await ask();
    const fresh = codeOf();
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    const late = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: fresh },
    });
    expect(late.body.error?.code).toBe("CODE_EXPIRED");
  });

  it("refuses throwaway email domains for new accounts", async () => {
    const { h, ask } = await ready();
    expect((await ask("x@mailinator.com")).body.error?.code).toBe("EMAIL_REJECTED");
    h.kv.store.set("disposable:domains", JSON.stringify(["fresh-throwaway.io"]));
    expect((await ask("x@fresh-throwaway.io")).body.error?.code).toBe("EMAIL_REJECTED");
    expect(h.mail).toHaveLength(0);
  });

  it("sends at most 5 emails an hour to one address", async () => {
    const { ask } = await ready();
    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(202);
    expect((await ask()).status).toBe(429);
  });

  it("needs a human pass", async () => {
    const h = await setup();
    const response = await h.call("/v1/auth/email", { method: "POST", body: { email: EMAIL } });
    expect(response.body.error?.code).toBe("CHALLENGE_REQUIRED");
  });

  // Review focus 1: the code typed in one tab and the link opened in another, at the same time.
  it("makes one account when the code and the link are used at the same time", async () => {
    const { h, ask, codeOf, tokenOf } = await ready();
    await ask();
    const [code, link] = await Promise.all([
      h.call("/v1/auth/code", { method: "POST", body: { email: EMAIL, code: codeOf() } }),
      h.call("/v1/auth/link", { method: "POST", body: { token: tokenOf() } }),
    ]);
    expect([code.status, link.status]).toEqual([200, 200]);
    expect([code.body.created, link.body.created].sort()).toEqual([false, true]);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 1 });
  });
});

// Final review: KV rejects TTLs under 60 seconds, which a wrong guess in the code's last minute hit.
describe("code expiry edge", () => {
  it("answers CODE_INVALID for a wrong guess in the code's last minute", async () => {
    const h = await setup();
    await h.pass();
    await h.call("/v1/auth/email", { method: "POST", body: { email: EMAIL } });
    const code = /\b(\d{6})\b/.exec(h.mail[0]?.subject ?? "")?.[1];
    vi.setSystemTime(Date.now() + 9.5 * 60_000);
    const wrong = code === "000000" ? "111111" : "000000";
    const response = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: wrong },
    });
    expect(response.body.error?.code).toBe("CODE_INVALID");
  });
});

// Final review: guessing codes was only slowed by a KV counter, and the per-email mail limit was
// spent before the human check, so anyone could lock an address out for an hour.
describe("sign-in abuse limits (spec 7.1)", () => {
  it("allows 10 code attempts an hour per email", async () => {
    const { h, ask } = await ready();
    await ask();
    for (let i = 0; i < 10; i++)
      await h.call("/v1/auth/code", { method: "POST", body: { email: EMAIL, code: "000000" } });
    const limited = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: "000000" },
    });
    expect(limited.status).toBe(429);
  });

  it("allows 30 link attempts an hour per IP segment", async () => {
    const { h } = await ready();
    for (let i = 0; i < 30; i++)
      await h.call("/v1/auth/link", { method: "POST", body: { token: "a".repeat(64) } });
    expect(
      (await h.call("/v1/auth/link", { method: "POST", body: { token: "a".repeat(64) } })).status,
    ).toBe(429);
  });

  it("does not let requests without a human pass use up an address's emails", async () => {
    const h = await setup();
    for (let i = 0; i < 6; i++)
      await h.call("/v1/auth/email", {
        method: "POST",
        body: { email: EMAIL },
        visitor: "f".repeat(32),
      });
    await h.pass();
    expect(
      (await h.call("/v1/auth/email", { method: "POST", body: { email: EMAIL } })).status,
    ).toBe(202);
  });
});
