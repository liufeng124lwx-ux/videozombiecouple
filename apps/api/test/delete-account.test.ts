import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobBody, setup } from "./harness.ts";

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

  it("removes files, anonymises jobs, forfeits credits and ends every session", async () => {
    const h = await setup();
    await h.pass();
    const session = await signUpByCode(h, "ann@example.com");
    const userId = (h.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    const created = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload()),
      session,
    });
    await h.advance(60_000);
    const jobId = created.body.jobId as string;
    expect([...h.r2.objects.keys()].some((k) => k.includes(jobId))).toBe(true);

    const response = await h.call("/v1/account/delete", {
      method: "POST",
      body: { confirm: "DELETE" },
      session,
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().some((v) => v.startsWith("upx_sess=;"))).toBe(true);

    expect([...h.r2.objects.keys()].some((k) => k.includes(jobId))).toBe(false);
    expect(h.r2.objects.size).toBe(0);
    expect(
      h.db.prepare("SELECT owner, visitor_hash, fp_hash FROM jobs WHERE id=?").get(jobId),
    ).toEqual({
      owner: "deleted",
      visitor_hash: "",
      fp_hash: null,
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

// Final review: deletion did not stop running jobs, could trip the idempotency index, and ended
// sessions last.
describe("delete account edge cases", () => {
  it("stops jobs still running: no files come back and no credits return after the forfeit", async () => {
    const h = await setup();
    await h.pass();
    const session = await signUpByCode(h, "ann@example.com");
    const userId = (h.db.prepare("SELECT id FROM users").get() as { id: string }).id;
    const free = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload()),
      session,
    });
    const pro = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload(), { capability: "unblur.pro" }),
      session,
    });
    await h.call("/v1/account/delete", { method: "POST", body: { confirm: "DELETE" }, session });
    await h.advance(200_000);
    expect(h.r2.objects.size).toBe(0);
    for (const id of [free.body.jobId as string, pro.body.jobId as string])
      expect(h.db.prepare("SELECT status FROM jobs WHERE id=?").get(id)).toEqual({
        status: "failed",
      });
    const types = h.db
      .prepare("SELECT type FROM credit_ledger WHERE user_id=? AND delta<>0 ORDER BY id")
      .all(userId)
      .map((row) => (row as { type: string }).type);
    expect(types.slice(-1)).toEqual(["expire"]);
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(0);
  });

  it("deletes two accounts whose jobs used the same idempotency key", async () => {
    const h = await setup();
    await h.pass();
    const body = (key: string) => ({ ...jobBody(key), idempotencyKey: "same-key-from-a-client" });
    for (const email of ["a@example.com", "b@example.com"]) {
      const session = await signUpByCode(h, email);
      await h.call("/v1/jobs", { method: "POST", body: body(await h.upload()), session });
      await h.advance(60_000);
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
    await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()), session });
    await h.advance(60_000);
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
