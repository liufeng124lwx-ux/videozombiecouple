import { RATE_LIMITS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashIdentity } from "../src/services/crypto.ts";
import { HMAC_KEY, setup } from "./harness.ts";

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

  it("an unverified guest account cannot be pre-claimed: no password before the email is proven, and the owner's first sign-in ends every earlier session", async () => {
    const { h, ask, codeOf, sessionOf } = await ready();
    // Someone types the victim's address at a guest checkout and keeps that browser signed in.
    const guest = await h.call("/v1/auth/guest", { method: "POST", body: { email: EMAIL } });
    expect(guest.status).toBe(201);
    const squatter = guest.cookies.upx_sess as string;
    const setPw = await h.call("/v1/account/password", {
      method: "POST",
      session: squatter,
      body: { password: "correct horse battery staple" },
    });
    expect(setPw.body.error?.code).toBe("FORBIDDEN");
    // A password set some other way before verification is wiped too.
    h.db.prepare("UPDATE users SET password_hash='x' WHERE email=?").run(EMAIL);
    // The real owner signs in with the emailed code.
    await ask();
    const owner = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: EMAIL, code: codeOf() },
    });
    expect(owner.status).toBe(200);
    expect((await h.call("/v1/me", { session: squatter })).body.user).toBeNull();
    expect((await h.call("/v1/me", { session: sessionOf(owner.headers) })).body.user).toMatchObject(
      { email: EMAIL },
    );
    expect(h.db.prepare("SELECT password_hash FROM users WHERE email=?").get(EMAIL)).toEqual({
      password_hash: null,
    });
  });

  it("a verified account's later sign-ins keep its other sessions", async () => {
    const { h, ask, codeOf } = await ready();
    const { session } = await h.signIn(EMAIL);
    await ask();
    await h.call("/v1/auth/code", { method: "POST", body: { email: EMAIL, code: codeOf() } });
    expect((await h.call("/v1/me", { session })).body.user).toMatchObject({ email: EMAIL });
  });

  it("a link opened in another browser asks first, and never takes that browser's guest stories", async () => {
    const { h, ask, tokenOf, sessionOf } = await ready();
    await h.signIn(EMAIL);
    await ask(); // requested in this browser (the default visitor)
    const token = tokenOf();
    const other = "fedcba9876543210fedcba9876543210";
    const asked = await h.call("/v1/auth/link", {
      method: "POST",
      body: { token },
      visitor: other,
    });
    expect(asked.body).toEqual({ ok: false, confirm: EMAIL });
    expect(sessionOf(asked.headers)).toBeUndefined();
    // Asking does not use the link up; confirming signs in without merging this browser's stories.
    h.db
      .prepare(
        "INSERT INTO stories(id,owner,user_id,visitor_hash,ip_hash,kind,scene,prompt_version,survivor_key,infected_key,status,idempotency_key,created_at,expires_at) VALUES('S1',?,'','v','i','human','cabin-wheat','h1','a','b','preview_ready','k',0,?)",
      )
      .run(`g:${await hashIdentity(`visitor:${other}`, HMAC_KEY)}`, Date.now() + 86_400_000);
    const confirmed = await h.call("/v1/auth/link", {
      method: "POST",
      body: { token, confirm: true },
      visitor: other,
    });
    expect(confirmed.body).toEqual({ ok: true, created: false });
    expect(sessionOf(confirmed.headers)).toBeDefined();
    expect(h.db.prepare("SELECT user_id FROM stories WHERE id='S1'").get()).toEqual({
      user_id: "",
    });
  });

  it("sends one address at most a day's worth of sign-in emails, however the hours are spread", async () => {
    const { h, ask } = await ready();
    let sent = 0;
    for (let hour = 0; hour < 6; hour++) {
      for (let i = 0; i < RATE_LIMITS.loginMailPerEmailHour; i++)
        if ((await ask()).status === 202) sent++;
      vi.setSystemTime(Date.now() + 3_600_000 + 1);
      await h.pass();
    }
    expect(sent).toBe(RATE_LIMITS.loginMailPerEmailDay);
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
