import type { FakeStep } from "@vzc/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liftKieCap, pauseForKieCap } from "../src/ops/kie-cap.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const SEEDREAM = "seedream/5-flash-image-to-image";
const flags = (h: Awaited<ReturnType<typeof setup>>) => JSON.parse(h.kv.store.get("flags") ?? "{}");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("kie key daily cap (cost guardrails spec 6)", () => {
  it("pauses everything, alerts once, and lifts its own pause on the next UTC day", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_env: Bindings, text: string) => void sent.push(text);
    await pauseForKieCap(env, NOON, send);
    await pauseForKieCap(env, NOON + 60_000, send);
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "kie-cap", pausedAt: NOON });
    expect(sent).toHaveLength(1);
    await liftKieCap(env, NOON + 3_600_000, send);
    expect(flags(h).paused).toBe(true);
    await liftKieCap(env, NOON + 12 * 3_600_000 + 60_000, send);
    expect(flags(h)).toMatchObject({ paused: false, pausedBy: null });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^Resolved/);
  });

  it("lifts only after kie's reset hour that follows the pause (reset at 16:00 UTC)", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const none = async () => {};
    const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour, minute);
    await pauseForKieCap(env, at(9, 15), none);
    await liftKieCap(env, at(9, 15, 59), none, 16);
    expect(flags(h).paused).toBe(true);
    await liftKieCap(env, at(9, 16, 1), none, 16);
    expect(flags(h)).toMatchObject({ paused: false, pausedBy: null });

    await pauseForKieCap(env, at(9, 17), none);
    await liftKieCap(env, at(10, 0, 1), none, 16);
    await liftKieCap(env, at(10, 15, 59), none, 16);
    expect(flags(h).paused).toBe(true);
    await liftKieCap(env, at(10, 16, 1), none, 16);
    expect(flags(h).paused).toBe(false);
  });

  it("never lifts or takes over an admin's pause", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    h.kv.store.set(
      "flags",
      JSON.stringify({ paused: true, pausedBy: "admin", pausedAt: NOON - 1000 }),
    );
    await pauseForKieCap(env, NOON, async () => {});
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "admin" });
    await liftKieCap(env, NOON + 86_400_000, async () => {});
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "admin" });
  });

  it("ends the job without trying the fallback route, refunded, and pauses the site", async () => {
    const script: Record<string, FakeStep[]> = {
      [SEEDREAM]: [{ kind: "submit_error", code: 433, msg: "apiKey has exceeded the daily limit" }],
    };
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(script) });
    const { spec, runner } = await h.job({
      charge: { kind: "credits", userId: "u1", reservationId: "r1", reserved: 1 },
    });
    await runner.start(spec);
    await h.advance(60_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "failed", errorCode: "PAUSED", chargedTier: null });
    // Only the first route was tried: no fallback attempt, so exactly one submit.
    expect(view?.attempts).toHaveLength(1);
    expect(h.wallet.calls).toEqual([["release", "u1", "r1", spec.id]]);
    expect(flags(h)).toMatchObject({ paused: true, pausedBy: "kie-cap" });
  });

  it("never takes over or lifts a legacy admin pause that has no owner recorded", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_env: Bindings, text: string) => void sent.push(text);
    h.kv.store.set("flags", JSON.stringify({ paused: true }));
    await pauseForKieCap(env, NOON, send);
    expect(flags(h)).toEqual({ paused: true });
    expect(sent).toHaveLength(1);
    await liftKieCap(env, NOON + 86_400_000, send);
    expect(flags(h)).toEqual({ paused: true });
  });

  it("still ends and refunds the job when pausing the site fails", async () => {
    const script: Record<string, FakeStep[]> = {
      [SEEDREAM]: [{ kind: "submit_error", code: 433, msg: "apiKey has exceeded the daily limit" }],
    };
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(script) });
    const put = h.kv.KV.put.bind(h.kv.KV);
    vi.spyOn(h.kv.KV, "put").mockImplementation(async (key, value, options) => {
      if (key === "flags") throw new Error("kv down");
      return put(key, value, options);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { spec, runner } = await h.job({
      charge: { kind: "credits", userId: "u1", reservationId: "r1", reserved: 1 },
    });
    await runner.start(spec);
    await h.advance(60_000);
    expect(await runner.view()).toMatchObject({
      status: "failed",
      errorCode: "PAUSED",
      chargedTier: null,
    });
    expect(h.wallet.calls).toEqual([["release", "u1", "r1", spec.id]]);
  });
});
