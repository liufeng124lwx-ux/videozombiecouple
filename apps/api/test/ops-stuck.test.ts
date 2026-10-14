import { ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStuck, stuckAfterMs } from "../src/ops/stuck.ts";
import { previewCounters, reserveQuota } from "../src/services/quota.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const START = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

/** Every route of the capability keeps its calls pending forever. */
const never = (capability: "keyframe" | "shot") =>
  JSON.stringify(
    Object.fromEntries(
      ROUTES.filter((r) => r.capability === capability).map((r) => [
        r.model,
        Array(12).fill({ kind: "never" }),
      ]),
    ),
  );

const status = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  h.db.prepare("SELECT status, error_code FROM stories WHERE id=?").get(id) as {
    status: string;
    error_code: string | null;
  };

describe("stuck stories (spec 8.2)", () => {
  it("allows for every route of every step before calling a story stuck", () => {
    const timeouts = (capability: "keyframe" | "shot") =>
      ROUTES.filter((r) => r.capability === capability).reduce((t, r) => t + r.timeoutMs, 0);
    expect(stuckAfterMs("rendering")).toBeGreaterThan(stuckAfterMs("previewing"));
    expect(stuckAfterMs("previewing")).toBeGreaterThanOrEqual(2 * timeouts("keyframe"));
    expect(stuckAfterMs("rendering")).toBeGreaterThanOrEqual(
      2 * (timeouts("keyframe") + timeouts("shot")),
    );
  });

  it("wakes a stuck preview first, and gives up on it (with its quota back) the round after", async () => {
    const h = await setup({ FAKE_SCRIPT: never("keyframe") });
    const env = h.env as unknown as Bindings;
    const { spec, runner } = await h.story();
    const counters = previewCounters(spec.userId, "ip");
    expect(await reserveQuota(env, counters, spec.id)).toBe(true);
    await runner.start(spec, {
      kind: "quota",
      nonce: spec.id,
      counters: counters.map((c) => c.name),
    });
    // Its calls never finish, and its alarm got lost.
    const entry = h.runners.entries.get(spec.id);
    entry?.store.clearAlarm();
    const late = START + stuckAfterMs("previewing") + 1_000;
    vi.setSystemTime(late);
    await checkStuck(env, late, async () => {});
    expect(entry?.store.alarmAt()).not.toBeNull();
    vi.setSystemTime(late + 300_000);
    entry?.store.clearAlarm();
    await checkStuck(env, late + 300_000, async () => {});
    expect(status(h, spec.id)).toMatchObject({ status: "preview_failed", error_code: "TIMEOUT" });
    expect(await h.limiters.instance(counters[0]?.name ?? "").used()).toBe(0);
  });

  it("fails a story whose runner never started, and says so", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const { spec } = await h.story();
    const late = START + stuckAfterMs("previewing") + 1_000;
    const sent: string[] = [];
    await checkStuck(env, late, async (_e, text) => void sent.push(text));
    await checkStuck(env, late + 300_000, async (_e, text) => void sent.push(text));
    expect(status(h, spec.id)).toMatchObject({ status: "failed", error_code: "TIMEOUT" });
    expect(sent.some((s) => s.includes(spec.id))).toBe(true);
  });

  it("leaves stories that are still inside their time alone", async () => {
    const h = await setup();
    const { spec } = await h.story();
    await checkStuck(h.env as unknown as Bindings, START + 60_000, async () => {});
    await checkStuck(h.env as unknown as Bindings, START + 360_000, async () => {});
    expect(status(h, spec.id).status).toBe("previewing");
  });

  it("gives a paid video's credits back when it gives up, even if the wallet fails at that moment", async () => {
    const h = await setup({ FAKE_SCRIPT: never("shot") });
    const env = h.env as unknown as Bindings;
    await h.pass();
    const { userId, session } = await h.signIn();
    const wallet = h.wallets.instance(userId);
    await wallet.grant(userId, {
      kind: "pack",
      credits: 10,
      expiresAt: null,
      sourceRef: null,
      reason: "test",
    });
    const { spec } = await h.readyStory({ owner: `u:${userId}`, userId });
    const rendered = await h.call(`/v1/stories/${spec.id}/render`, {
      method: "POST",
      body: { idempotencyKey: `render-${spec.id}` },
      session,
    });
    expect(rendered.status).toBe(202);
    expect((await wallet.balance(userId)).total).toBe(0);
    const entry = h.runners.entries.get(spec.id);
    entry?.store.clearAlarm();
    const late = Date.now() + stuckAfterMs("rendering") + 1_000;
    vi.setSystemTime(late);
    await checkStuck(env, late, async () => {});
    entry?.store.clearAlarm();
    vi.setSystemTime(late + 300_000);
    h.wallet.releaseFailures = 1;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await checkStuck(env, late + 300_000, async () => {});
    expect(status(h, spec.id)).toMatchObject({ status: "failed", error_code: "TIMEOUT" });
    await h.advance(10 * 60_000);
    expect((await wallet.balance(userId)).total).toBe(10);
  });
});
