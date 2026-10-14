import { SPEND_CAPS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settle } from "../src/services/settle.ts";
import { dailyCreditCap } from "../src/services/spend-cap.ts";
import type { Bindings } from "../src/types.ts";
import { jobBody, setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;
const NBP = "nano-banana-pro";

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
  const create = async (overrides: Record<string, unknown> = {}) =>
    h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload(), overrides), session });
  const balance = async () => (await wallet.balance(userId)).total;
  return { h, userId, session, create, balance };
}

describe("per-account daily credits (cost guardrails spec 4)", () => {
  it("gives never-paid and new payers the lower cap, older payers the higher one, admins any", async () => {
    const { h, userId } = await member(0);
    const env = h.env as unknown as Bindings;
    expect(await dailyCreditCap(env, userId, NOON)).toBe(SPEND_CAPS.newPayerDailyCredits);
    h.db
      .prepare(
        "INSERT INTO orders(id,provider,provider_order_id,user_id,product_key,status,created_at) VALUES('o1','waffo','p1',?,'pack60','paid',?)",
      )
      .run(userId, NOON - 8 * DAY);
    expect(await dailyCreditCap(env, userId, NOON)).toBe(SPEND_CAPS.dailyCredits);
    h.db.prepare("UPDATE users SET daily_credit_cap=5 WHERE id=?").run(userId);
    expect(await dailyCreditCap(env, userId, NOON)).toBe(5);
  });

  it("refuses with DAILY_LIMIT past the cap and lets parallel requests through only up to the cap", async () => {
    const { h, userId, create } = await member(100);
    h.db.prepare("UPDATE users SET daily_credit_cap=6 WHERE id=?").run(userId);
    // use up the 4 free photos first so the next jobs pay credits
    for (let i = 0; i < 4; i++) await create();
    const pro = { capability: "unblur.pro" };
    const results = await Promise.all([create(pro), create(pro), create(pro)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.find((r) => r.status !== 201)?.body.error?.code).toBe("DAILY_LIMIT");
  });

  it("gives the allowance back when a paid job fails, so the same day can submit again", async () => {
    const { h, userId, create, balance } = await member(100, {
      FAKE_SCRIPT: JSON.stringify({
        [NBP]: [{ kind: "submit_error", code: 422, msg: "image could not be processed" }],
      }),
    });
    h.db.prepare("UPDATE users SET daily_credit_cap=6 WHERE id=?").run(userId);
    for (let i = 0; i < 4; i++) await create();
    const pro = { capability: "unblur.4k" };
    // The fake provider refuses the input, so the first job fails and its 6 credits are released;
    // a second 4K job only fits under the cap of 6 if that allowance came back.
    expect((await create(pro)).status).toBe(201);
    await h.advance(200_000);
    expect(await balance()).toBe(100);
    expect((await create(pro)).status).toBe(201);
  });

  it("gives the allowance back when the wallet fails while reserving", async () => {
    const { h, userId, create } = await member(100);
    h.db.prepare("UPDATE users SET daily_credit_cap=6 WHERE id=?").run(userId);
    for (let i = 0; i < 4; i++) await create();
    const binding = h.env.WALLET as { get: (id: string) => Record<string, unknown> };
    const get = binding.get;
    binding.get = (id: string) => ({
      ...get(id),
      reserve: async () => {
        throw new Error("wallet unavailable");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pro = { capability: "unblur.4k" };
    expect((await create(pro)).status).toBeGreaterThanOrEqual(500);
    binding.get = get;
    // 4K costs the whole cap of 6: it only fits if the failed request gave its allowance back.
    expect((await create(pro)).status).toBe(201);
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
