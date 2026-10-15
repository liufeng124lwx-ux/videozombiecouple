import { TIERS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callbackToken } from "../src/services/crypto.ts";
import { HMAC_KEY, setup, storyBody } from "./harness.ts";

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

const previewsLeft = async (h: H, session: string) =>
  (await h.call("/v1/quota", { session })).body.remaining as number;

describe("story API", () => {
  it("guests get LOGIN_REQUIRED", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const res = await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) });
    expect(res.status).toBe(401);
    expect(res.body.error?.code).toBe("LOGIN_REQUIRED");
  });

  it("rejects another browser's upload without taking a free preview", async () => {
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
    expect(await previewsLeft(h, session)).toBe(3);
  });

  it("rejects photos too small for a face without taking a free preview", async () => {
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
    expect(await previewsLeft(h, session)).toBe(3);
  });

  it("gives three free previews a day, then PREVIEW_QUOTA_EXHAUSTED", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    for (let i = 0; i < 3; i++) expect((await create(h, session)).status).toBe(201);
    const fourth = await create(h, session);
    expect(fourth.status).toBe(402);
    expect(fourth.body.error?.code).toBe("PREVIEW_QUOTA_EXHAUSTED");
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
    expect(await previewsLeft(h, session)).toBe(2);
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
    await h.wallets
      .instance(userId)
      .grant(userId, {
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
