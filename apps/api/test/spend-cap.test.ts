import { ROUTES, SPEND_CAPS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../src/services/settle.ts";
import { dailyCreditCap } from "../src/services/spend-cap.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;
const DOWN = { kind: "fail", failMsg: "internal error" };
const SHOTS_DOWN = JSON.stringify(
  Object.fromEntries(
    ROUTES.filter((r) => r.capability === "shot")
      .map((r) => r.model)
      .map((m) => [m, Array(8).fill(DOWN)]),
  ),
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

async function member(credits: number, extra: Record<string, unknown> = {}) {
  const h = await setup(extra);
  await h.pass();
  const { userId, session } = await h.signIn();
  const wallet = h.wallets.instance(userId);
  if (credits > 0)
    await wallet.grant(userId, {
      kind: "pack",
      credits,
      expiresAt: null,
      sourceRef: null,
      reason: "test",
    });
  /** A story with its preview done, then POST /render on it. */
  const ready = async () => (await h.readyStory({ owner: `u:${userId}`, userId })).spec.id;
  const render = (id: string) =>
    h.call(`/v1/stories/${id}/render`, {
      method: "POST",
      body: { idempotencyKey: `render-${id}` },
      session,
    });
  const balance = async () => (await wallet.balance(userId)).total;
  return { h, userId, session, ready, render, balance };
}

describe("per-account daily credits (cost guardrails spec 4)", () => {
  it("gives never-paid and new payers the lower cap, older payers the higher one, admins any", async () => {
    const { h, userId } = await member(0);
    const env = h.env as unknown as Bindings;
    expect(await dailyCreditCap(env, userId, NOON)).toBe(SPEND_CAPS.newPayerDailyCredits);
    h.db
      .prepare(
        "INSERT INTO orders(id,provider,provider_order_id,user_id,product_key,status,created_at) VALUES('o1','waffo','p1',?,'pack1','paid',?)",
      )
      .run(userId, NOON - 8 * DAY);
    expect(await dailyCreditCap(env, userId, NOON)).toBe(SPEND_CAPS.dailyCredits);
    h.db.prepare("UPDATE users SET daily_credit_cap=5 WHERE id=?").run(userId);
    expect(await dailyCreditCap(env, userId, NOON)).toBe(5);
  });

  it("refuses with DAILY_LIMIT past the cap and lets parallel requests through only up to the cap", async () => {
    const { h, userId, ready, render } = await member(100);
    h.db.prepare("UPDATE users SET daily_credit_cap=20 WHERE id=?").run(userId);
    const ids = [await ready(), await ready(), await ready()];
    const results = await Promise.all(ids.map(render));
    expect(results.filter((r) => r.status === 202)).toHaveLength(2);
    expect(results.find((r) => r.status !== 202)?.body.error?.code).toBe("DAILY_LIMIT");
  });

  it("gives the allowance back when a paid video fails, so the same day can render again", async () => {
    const { h, userId, ready, render, balance } = await member(100, { FAKE_SCRIPT: SHOTS_DOWN });
    h.db.prepare("UPDATE users SET daily_credit_cap=10 WHERE id=?").run(userId);
    const first = await ready();
    const second = await ready();
    // Every shot route fails, so the video fails and its 10 credits are released; a second video
    // only fits under the cap of 10 if that allowance came back.
    expect((await render(first)).status).toBe(202);
    await h.untilStory(first, "failed");
    expect(await balance()).toBe(100);
    expect((await render(second)).status).toBe(202);
  });

  it("gives the allowance back when the wallet fails while reserving", async () => {
    const { h, userId, ready, render } = await member(100);
    h.db.prepare("UPDATE users SET daily_credit_cap=10 WHERE id=?").run(userId);
    const id = await ready();
    const binding = h.env.WALLET as { get: (id: string) => Record<string, unknown> };
    const get = binding.get;
    binding.get = (id: string) => ({
      ...get(id),
      reserve: async () => {
        throw new Error("wallet unavailable");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await render(id)).status).toBeGreaterThanOrEqual(500);
    binding.get = get;
    // A video costs the whole cap of 10: it only fits if the failed request gave its allowance back.
    expect((await render(id)).status).toBe(202);
  });

  it("settles an old credit hold that has no spendCounter", async () => {
    const { h } = await member(10);
    const env = h.env as unknown as Bindings;
    await expect(
      settle(
        env,
        "J-old",
        { kind: "credits", userId: "u-old", reservationId: "J-old", reserved: 1 },
        null,
      ),
    ).resolves.toBeUndefined();
  });
});
