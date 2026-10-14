import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

async function signUpByCode(h: Awaited<ReturnType<typeof setup>>, email: string) {
  await h.call("/v1/auth/email", {
    method: "POST",
    body: { email },
    headers: { "x-device": "device-aaaaaaaa" },
  });
  const code = /\b(\d{6})\b/.exec(h.mail[h.mail.length - 1]?.subject ?? "")?.[1];
  const response = await h.call("/v1/auth/code", {
    method: "POST",
    body: { email, code },
    headers: { "x-device": "device-aaaaaaaa" },
  });
  return /upx_sess=([a-f0-9]{64})/.exec(response.headers.getSetCookie().join(";"))?.[1] as string;
}

const userOf = (h: Awaited<ReturnType<typeof setup>>, email: string) => {
  const { id } = h.db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: string };
  return { owner: `u:${id}`, userId: id };
};

describe("delete account (spec 5.5)", () => {
  it("needs the word DELETE and a session", async () => {
    const h = await setup();
    const { session } = await h.signIn();
    expect(
      (await h.call("/v1/account/delete", { method: "POST", body: { confirm: "DELETE" } })).status,
    ).toBe(401);
    expect((await h.call("/v1/account/delete", { method: "POST", body: {}, session })).status).toBe(
      400,
    );
  });

  it("removes files, anonymises stories, forfeits credits and ends every session", async () => {
    const h = await setup();
    await h.pass();
    const session = await signUpByCode(h, "ann@example.com");
    const { userId, owner } = userOf(h, "ann@example.com");
    const { spec } = await h.readyStory({ owner, userId, names: "Ann & Bo" });
    expect([...h.r2.objects.keys()].some((k) => k.startsWith(`kf/${spec.id}/`))).toBe(true);

    const response = await h.call("/v1/account/delete", {
      method: "POST",
      body: { confirm: "DELETE" },
      session,
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((v) => v.startsWith("upx_sess=;"))).toBe(true);

    expect(h.r2.objects.size).toBe(0);
    expect(
      h.db
        .prepare("SELECT owner, user_id, visitor_hash, fp_hash, names FROM stories WHERE id=?")
        .get(spec.id),
    ).toEqual({
      owner: "deleted",
      user_id: "deleted",
      visitor_hash: "",
      fp_hash: null,
      names: null,
    });
    const user = h.db
      .prepare("SELECT email, password_hash, google_sub, deleted_at FROM users")
      .get() as {
      email: string;
      deleted_at: number | null;
    };
    expect(user.email).toMatch(/^deleted:[0-9a-f]{64}$/);
    expect(user.deleted_at).not.toBeNull();
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(0);
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 0 });
    expect((await h.call("/v1/me", { session })).body.user).toBeNull();
  });

  // Review focus 4: same email, same device, right after deleting.
  it("lets the email sign up again as a fresh account without a second bonus", async () => {
    const h = await setup();
    await h.pass();
    const first = await signUpByCode(h, "ann@example.com");
    await h.call("/v1/account/delete", {
      method: "POST",
      body: { confirm: "DELETE" },
      session: first,
    });
    const second = await signUpByCode(h, "ann@example.com");
    const me = await h.call("/v1/me", { session: second });
    expect(me.body.user).toMatchObject({ email: "ann@example.com" });
    expect(me.body.credits).toBe(0);
    expect((await h.call("/v1/me", { session: first })).body.user).toBeNull();
  });
});

// Final review: deletion did not stop running stories, could trip the idempotency index, and ended
// sessions last.
describe("delete account edge cases", () => {
  it("stops stories still running: no files come back and no credits return after the forfeit", async () => {
    const h = await setup();
    await h.pass();
    const session = await signUpByCode(h, "ann@example.com");
    const { userId, owner } = userOf(h, "ann@example.com");
    const wallet = h.wallets.instance(userId);
    await wallet.grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: null,
      reason: "test",
    });
    const video = await h.readyStory({ owner, userId });
    const rendered = await h.call(`/v1/stories/${video.spec.id}/render`, {
      method: "POST",
      body: { idempotencyKey: `render-${video.spec.id}` },
      session,
    });
    expect(rendered.status).toBe(202);
    const preview = await h.story({ owner, userId });
    await preview.runner.start(preview.spec, h.noCharge);
    await h.call("/v1/account/delete", { method: "POST", body: { confirm: "DELETE" }, session });
    await h.advance(200_000);
    expect(h.r2.objects.size).toBe(0);
    const statusOf = (id: string) => h.db.prepare("SELECT status FROM stories WHERE id=?").get(id);
    expect(statusOf(video.spec.id)).toEqual({ status: "failed" });
    expect(statusOf(preview.spec.id)).toEqual({ status: "preview_failed" });
    const types = h.db
      .prepare("SELECT type FROM credit_ledger WHERE user_id=? AND delta<>0 ORDER BY id")
      .all(userId)
      .map((row) => (row as { type: string }).type);
    expect(types.slice(-1)).toEqual(["expire"]);
    expect((await wallet.balance(userId)).total).toBe(0);
  });

  it("deletes two accounts whose stories used the same idempotency key", async () => {
    const h = await setup();
    await h.pass();
    for (const email of ["a@example.com", "b@example.com"]) {
      const session = await signUpByCode(h, email);
      const { spec } = await h.story(userOf(h, email));
      h.db
        .prepare("UPDATE stories SET idempotency_key='same-key-from-a-client' WHERE id=?")
        .run(spec.id);
      const response = await h.call("/v1/account/delete", {
        method: "POST",
        body: { confirm: "DELETE" },
        session,
      });
      expect(response.status).toBe(200);
    }
  });

  it("ends the sessions first, even if removing files fails", async () => {
    const h = await setup();
    await h.pass();
    const session = await signUpByCode(h, "ann@example.com");
    await h.story(userOf(h, "ann@example.com"));
    (h.env.BUCKET as { delete: (key: string) => Promise<void> }).delete = async () => {
      throw new Error("R2 unavailable");
    };
    expect(
      (await h.call("/v1/account/delete", { method: "POST", body: { confirm: "DELETE" }, session }))
        .status,
    ).toBe(500);
    expect((await h.call("/v1/me", { session })).body.user).toBeNull();
  });
});
