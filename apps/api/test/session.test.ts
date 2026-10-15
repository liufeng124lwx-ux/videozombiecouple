import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("sessions (spec 5.1)", () => {
  it("shows the signed-in user and makes them the owner", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn("ann@example.com");
    const me = await h.call("/v1/me", { session });
    expect(me.body).toEqual({
      user: {
        id: userId,
        email: "ann@example.com",
        hasPassword: false,
        google: false,
        verified: true,
      },
      owner: `u:${userId}`,
      credits: 0,
      banner: null,
      consentRequired: true,
      paid: false,
    });
  });

  it("treats unknown, malformed and expired sessions as signed out", async () => {
    const h = await setup();
    const { session } = await h.signIn();
    expect((await h.call("/v1/me", { session: "f".repeat(64) })).body.user).toBeNull();
    expect((await h.call("/v1/me", { session: "nope" })).body.user).toBeNull();
    vi.setSystemTime(Date.now() + 91 * 86_400_000);
    expect((await h.call("/v1/me", { session })).body.user).toBeNull();
  });

  it("signs out: clears both cookies and ends the session everywhere it is used", async () => {
    const h = await setup();
    const { session } = await h.signIn();
    const out = await h.call("/v1/auth/logout", { method: "POST", session });
    expect(out.status).toBe(200);
    const cookies = out.headers.getSetCookie();
    expect(cookies.some((v) => v.startsWith("upx_sess=;"))).toBe(true);
    expect(cookies.some((v) => v.startsWith("upx_in=;"))).toBe(true);
    expect((await h.call("/v1/me", { session })).body.user).toBeNull();
  });

  it("ignores the session of a deleted account", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    h.db.prepare("UPDATE users SET deleted_at=? WHERE id=?").run(Date.now(), userId);
    expect((await h.call("/v1/me", { session })).body.user).toBeNull();
  });

  it("blocks a banned account", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    h.db
      .prepare("INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)")
      .run(userId, "account", Date.now() + 60_000, "test");
    expect((await h.call("/v1/me", { session })).status).toBe(403);
  });

  it("creates one account when the same email signs up twice at once", async () => {
    const h = await setup();
    const { createUser } = await import("../src/services/users.ts");
    const [a, b] = await Promise.all([
      createUser(h.env.DB as D1Database, "same@example.com"),
      createUser(h.env.DB as D1Database, "same@example.com"),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
  });
});
