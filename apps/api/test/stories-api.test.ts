import { RETENTION, TIERS } from "@vzc/catalog";
import { UPLOAD_CONSENT_VERSION, WITHDRAWAL_WAIVER_VERSION } from "@vzc/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callbackToken } from "../src/services/crypto.ts";
import { HMAC_KEY, setup, storyBody } from "./harness.ts";
import { stripeEnv } from "./stripe-kit.ts";

const T0 = Date.UTC(2026, 9, 14, 12);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

type H = Awaited<ReturnType<typeof setup>>;

async function signedIn(h: H, email = "user@example.com") {
  const { userId, session } = await h.signIn(email);
  await h.pass();
  return { userId, session };
}

async function create(h: H, session: string, body?: Record<string, unknown>) {
  const a = await h.upload();
  const b = await h.upload();
  return h.call("/v1/stories", { method: "POST", session, body: body ?? storyBody(a, b) });
}

const kfFiles = (h: H) => [...h.r2.objects.keys()].filter((k) => k.startsWith("kf/"));

describe("story API", () => {
  it("a guest can start a story: the photos are checked, nothing is generated", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const res = await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) });
    expect(res.status).toBe(201);
    const id = res.body.storyId as string;
    await h.untilStory(id, "preview_ready");
    expect(kfFiles(h)).toEqual([]);
    // Paying needs an account: the guest gets one by email first.
    const render = await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      body: { idempotencyKey: "render-guest" },
    });
    expect(render.body.error?.code).toBe("LOGIN_REQUIRED");
  });

  it("a guest's new email becomes an unverified account that owns the story; a known email never signs in", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const id = (await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) })).body
      .storyId as string;
    await h.untilStory(id, "preview_ready");
    const signUp = await h.call("/v1/auth/guest", {
      method: "POST",
      body: { email: "new@example.com" },
    });
    expect(signUp.status).toBe(201);
    const session = signUp.cookies.upx_sess as string;
    const user = h.db
      .prepare("SELECT id, email_verified_at FROM users WHERE email=?")
      .get("new@example.com") as {
      id: string;
      email_verified_at: number | null;
    };
    expect(user.email_verified_at).toBeNull();
    expect((await h.call(`/v1/stories/${id}`, { session })).status).toBe(200);
    // Typing someone else's address (verified or not) never opens their account.
    const other = await setup({ FAKE_COMPOSER: "1" });
    await other.signIn("known@example.com");
    await other.pass();
    const again = await other.call("/v1/auth/guest", {
      method: "POST",
      body: { email: "known@example.com" },
    });
    expect(again.body.error?.code).toBe("LOGIN_REQUIRED");
    expect(again.cookies.upx_sess).toBeUndefined();
  });

  it("needs the uploader's consent (face analysis, the other person's agreement) and records which text they agreed to", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const { consent: _c, ...without } = storyBody(a, b) as Record<string, unknown>;
    const refused = await h.call("/v1/stories", { method: "POST", body: without });
    expect(refused.body.error?.code).toBe("CONSENT_REQUIRED");
    const old = await h.call("/v1/stories", {
      method: "POST",
      body: { ...without, consent: "2020-01-01" },
    });
    expect(old.body.error?.code).toBe("CONSENT_REQUIRED");
    const ok = await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) });
    expect(ok.status).toBe(201);
    expect(
      h.db
        .prepare("SELECT consent_version, consent_at FROM stories WHERE id=?")
        .get(ok.body.storyId as string),
    ).toEqual({ consent_version: UPLOAD_CONSENT_VERSION, consent_at: T0 });
  });

  it("in Illinois only the pet version is offered (BIPA: the second person's face)", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const il = { "cf-ipcountry": "US", "cf-region-code": "IL" };
    const a = await h.upload();
    const b = await h.upload();
    const human = await h.call("/v1/stories", {
      method: "POST",
      body: storyBody(a, b),
      headers: il,
    });
    expect(human.body.error?.code).toBe("REGION_UNAVAILABLE");
    const pet = await h.call("/v1/stories", {
      method: "POST",
      body: storyBody(a, b, { kind: "pet", idempotencyKey: "idem-pet-il-000000" }),
      headers: il,
    });
    expect(pet.status).toBe(201);
    const c2 = await h.upload();
    const d2 = await h.upload();
    const ny = await h.call("/v1/stories", {
      method: "POST",
      body: storyBody(c2, d2, { idempotencyKey: "idem-ny-0000000000" }),
      headers: { "cf-ipcountry": "US", "cf-region-code": "NY" },
    });
    expect(ny.status).toBe(201);
  });

  it("rejects another browser's upload", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const mine = await h.upload();
    await h.pass("fedcba9876543210fedcba9876543210");
    const theirs = await h.upload({ visitor: "fedcba9876543210fedcba9876543210" });
    const res = await h.call("/v1/stories", {
      method: "POST",
      session,
      body: storyBody(mine, theirs),
    });
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("rejects photos too small for a face", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const small = await h.upload({ width: 300, height: 300 });
    const ok = await h.upload();
    const res = await h.call("/v1/stories", {
      method: "POST",
      session,
      body: storyBody(ok, small),
    });
    expect(res.body.error?.code).toBe("FILE_UNSUPPORTED");
  });

  it("never gives anything for free: many stories start, none generates before payment", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    for (let i = 0; i < 4; i++) expect((await create(h, session)).status).toBe(201);
    await h.advance(60_000);
    expect(kfFiles(h)).toEqual([]);
  });

  it("returns the same story for the same idempotency key", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const a = await h.upload();
    const b = await h.upload();
    const body = storyBody(a, b, { idempotencyKey: "same-key-123" });
    const first = await h.call("/v1/stories", { method: "POST", session, body });
    const again = await h.call("/v1/stories", { method: "POST", session, body });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.storyId).toBe(first.body.storyId);
  });

  it("render without credits is CREDITS_LOW and leaves the story ready", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    const res = await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-1" },
    });
    expect(res.body.error?.code).toBe("CREDITS_LOW");
    expect((await h.call(`/v1/stories/${id}`, { session })).body.status).toBe("preview_ready");
  });

  it("render twice charges once", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 30,
      expiresAt: null,
      sourceRef: "order-x",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    const body = { idempotencyKey: "render-1" };
    const [one, two] = await Promise.all([
      h.call(`/v1/stories/${id}/render`, { method: "POST", session, body }),
      h.call(`/v1/stories/${id}/render`, { method: "POST", session, body }),
    ]);
    expect([one.status, two.status]).toEqual([202, 202]);
    await h.untilStory(id, "done");
    const balance = await h.wallets.instance(userId).balance(userId);
    // No hold is left behind by the request that lost the race.
    expect(h.db.prepare("SELECT state FROM credit_reservations WHERE state='held'").all()).toEqual(
      [],
    );
    expect(balance.total).toBe(30 - TIERS.video.credits);
    expect(h.wallet.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  it("renders a failed video again under a new reservation, so it is charged once on success", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 30,
      expiresAt: null,
      sourceRef: "order-y",
      reason: "test",
    });
    let composeErrors = 99;
    const fake = (await import("../src/services/composer.ts")).fakeComposer(h.env as never);
    h.env.COMPOSER_IMPL = {
      score: fake.score,
      compose: async (r: Parameters<typeof fake.compose>[0]) => {
        if (composeErrors-- > 0) throw new Error("composer down");
        return fake.compose(r);
      },
    };
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-1" },
    });
    await h.untilStory(id, "failed");
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(30);
    composeErrors = 0;
    const again = await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-2" },
    });
    expect(again.status).toBe(202);
    await h.untilStory(id, "done");
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(30 - TIERS.video.credits);
  });

  it("an expired preview can no longer be read or rendered", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: "order-z",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    vi.setSystemTime(Date.now() + 3 * 86_400_000 + 60_000);
    expect((await h.call(`/v1/stories/${id}`, { session })).status).toBe(404);
    const render = await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-x" },
    });
    expect(render.status).toBe(404);
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(10);
  });

  it("deleting the account erases each story's runner data", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    const { deleteAccount } = await import("../src/services/delete-account.ts");
    await deleteAccount(h.env as never, userId);
    expect(await h.runners.instance(id).view()).toBeNull();
  });

  it("a title change restarts the stuck clock (rendered_at)", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: "order-t",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-t" },
    });
    await h.untilStory(id, "done");
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    const at = Date.now();
    await h.call(`/v1/stories/${id}/recompose`, {
      method: "POST",
      session,
      body: { names: "A", date: "B" },
    });
    const row = h.db.prepare("SELECT rendered_at FROM stories WHERE id=?").get(id) as {
      rendered_at: number;
    };
    expect(row.rendered_at).toBeGreaterThanOrEqual(at);
  });

  it("a finished film can be watched by anyone holding its share link, and only that", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: "order-s",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    // No share link before the film exists.
    expect((await h.call(`/v1/stories/${id}`, { session })).body.shareToken).toBeNull();
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-s" },
    });
    await h.untilStory(id, "done");
    const token = (await h.call(`/v1/stories/${id}`, { session })).body.shareToken as string;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    const shared = await h.call(`/v1/share/${id}?t=${token}`);
    expect(shared.status).toBe(200);
    expect(Object.keys(shared.body).sort()).toEqual(["date", "names", "scene", "video"]);
    expect((shared.body.video as { url: string }).url).toBeTruthy();
    expect((await h.call(`/v1/share/${id}?t=${"0".repeat(32)}`)).status).toBe(404);
    expect((await h.call(`/v1/share/${id}`)).status).toBe(404);
  });

  it("an unverified buyer's film is kept 3 days, a verified one 30; verifying later extends it; one reminder the day before", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const id = (await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) })).body
      .storyId as string;
    await h.untilStory(id, "preview_ready");
    const session = (
      await h.call("/v1/auth/guest", { method: "POST", body: { email: "g@example.com" } })
    ).cookies.upx_sess as string;
    const user = h.db.prepare("SELECT id FROM users WHERE email=?").get("g@example.com") as {
      id: string;
    };
    await h.wallets.instance(user.id).grant(user.id, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: "order-g",
      reason: "test",
    });
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-g" },
    });
    await h.untilStory(id, "done");
    const row = () =>
      h.db.prepare("SELECT expires_at, finished_at, retention FROM stories WHERE id=?").get(id) as {
        expires_at: number;
        finished_at: number;
        retention: string;
      };
    expect(row().retention).toBe("guest");
    expect(row().expires_at - row().finished_at).toBe(RETENTION.guestFilmDays * 86_400_000);
    const view = await h.call(`/v1/stories/${id}`, { session });
    expect((view.body.video as { expiresAt: number }).expiresAt).toBe(row().expires_at);
    // The film-ready email says when it goes and offers to keep it longer.
    expect(h.mail.at(-1)?.text).toMatch(/deleted on/);
    expect(h.mail.at(-1)?.text).toMatch(/\/account\?login=/);
    // The day before deletion: one reminder.
    const { remindBeforeDeletion } = await import("../src/ops/reminders.ts");
    const mails = h.mail.length;
    expect(await remindBeforeDeletion(h.env as never, row().expires_at - 3_600_000)).toBe(1);
    expect(await remindBeforeDeletion(h.env as never, row().expires_at - 1_800_000)).toBe(0);
    expect(h.mail.length).toBe(mails + 1);
    // Proving the email (here: a code sign-in) keeps the film 30 days.
    const { keepFilmsLonger } = await import("../src/services/merge.ts");
    await keepFilmsLonger(h.env as never, user.id);
    expect(row().retention).toBe("member");
    expect(row().expires_at - row().finished_at).toBe(RETENTION.memberFilmDays * 86_400_000);
  });

  it("remakes a paid film once for free through the API", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: "order-r",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-r" },
    });
    await h.untilStory(id, "done");
    expect((await h.call(`/v1/stories/${id}/remake`, { method: "POST", session })).status).toBe(
      202,
    );
    await h.untilStory(id, "done");
    expect((await h.wallets.instance(userId).balance(userId)).total).toBe(0);
    const again = await h.call(`/v1/stories/${id}/remake`, { method: "POST", session });
    expect(again.body.error?.code).toBe("REMAKE_USED");
  });

  it("a refund that could not take its credits back, a chargeback or a paid pause stops remakes, renders and checkouts", async () => {
    const h = await setup({ FAKE_COMPOSER: "1", ...stripeEnv() });
    const { userId, session } = await signedIn(h);
    await h.wallets.instance(userId).grant(userId, {
      kind: "pack",
      credits: 20,
      expiresAt: null,
      sourceRef: "order-d",
      reason: "test",
    });
    const id = (await create(h, session)).body.storyId as string;
    await h.untilStory(id, "preview_ready");
    await h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      session,
      body: { idempotencyKey: "render-d" },
    });
    await h.untilStory(id, "done");
    const other = (await create(h, session)).body.storyId as string;
    await h.untilStory(other, "preview_ready");
    const remake = () => h.call(`/v1/stories/${id}/remake`, { method: "POST", session });
    const render = () =>
      h.call(`/v1/stories/${other}/render`, {
        method: "POST",
        session,
        body: { idempotencyKey: "render-d2" },
      });
    const buy = () =>
      h.call("/v1/billing/checkout", {
        method: "POST",
        session,
        body: { productKey: "pack1", waiver: WITHDRAWAL_WAIVER_VERSION },
      });
    // Refunded after the credits were spent: what could not be taken back is owed.
    h.db.prepare("UPDATE users SET refund_debt=10 WHERE id=?").run(userId);
    expect((await remake()).body.error?.code).toBe("FORBIDDEN");
    expect((await render()).body.error?.code).toBe("FORBIDDEN");
    expect((await buy()).body.error?.code).toBe("FORBIDDEN");
    h.db.prepare("UPDATE users SET refund_debt=0, paid_paused_at=? WHERE id=?").run(T0, userId);
    expect((await remake()).body.error?.code).toBe("FORBIDDEN");
    h.db.prepare("UPDATE users SET paid_paused_at=NULL WHERE id=?").run(userId);
    // The daily paid line (or an admin) paused paid work: no remake and no new purchase either.
    h.kv.store.set("flags", JSON.stringify({ paidPaused: true, paidPausedBy: "ops" }));
    vi.setSystemTime(Date.now() + 61_000); // flags are cached for a minute
    expect((await remake()).body.error?.code).toBe("PAUSED");
    expect((await buy()).body.error?.code).toBe("PAUSED");
  });

  it("only the owner can read a story", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const id = (await create(h, session)).body.storyId as string;
    const other = await h.signIn("other@example.com");
    expect((await h.call(`/v1/stories/${id}`, { session: other.session })).status).toBe(404);
    expect((await h.call(`/v1/stories/${id}`, { session })).status).toBe(200);
  });

  it("lists the account's stories, newest first", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const first = (await create(h, session)).body.storyId;
    vi.setSystemTime(T0 + 60_000);
    const second = (await create(h, session)).body.storyId;
    const list = (await h.call("/v1/stories", { session })).body.stories as { id: string }[];
    expect(list.map((s) => s.id)).toEqual([second, first]);
  });

  it("kie callbacks need a valid token; a good one pokes the runner", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const id = (await create(h, session)).body.storyId as string;
    const bad = await h.call(`/webhooks/kie/${id}?t=nope`, { method: "POST", body: {} });
    expect(bad.status).toBe(403);
    const token = await callbackToken(id, HMAC_KEY);
    const good = await h.call(`/webhooks/kie/${id}?t=${token}`, { method: "POST", body: {} });
    expect(good.status).toBe(200);
  });
});
