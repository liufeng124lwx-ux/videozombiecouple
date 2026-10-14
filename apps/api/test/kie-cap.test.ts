import type { FakeStep } from "@vzc/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liftKieCap, pauseForKieCap } from "../src/ops/kie-cap.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const SHOT_MODELS = ["bytedance/seedance-2-mini", "kling-3.0/video", "wan/2-7-image-to-video"];
/** Every shot model refuses its first call: the kie key hit its daily cap. */
const CAPPED: Record<string, FakeStep[]> = Object.fromEntries(
  SHOT_MODELS.map((m) => [
    m,
    [{ kind: "submit_error", code: 433, msg: "apiKey has exceeded the daily limit" }],
  ]),
);
const HOLD = { kind: "credits", userId: "u1", reservationId: "r1", reserved: 10 } as const;

/** The steps StoryRunner wrote to D1, with their attempts. */
const stepsOf = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  JSON.parse(
    (h.db.prepare("SELECT steps FROM stories WHERE id=?").get(id) as { steps: string }).steps,
  ) as { id: string; attempts: { failKind: string | null }[] }[];
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

  it("ends the video without trying the fallback route, refunded, and pauses the site", async () => {
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(CAPPED) });
    const { spec, runner } = await h.readyStory();
    expect(await runner.render(HOLD)).toEqual({ ok: true });
    await h.advance(60_000);
    expect(await runner.view()).toMatchObject({
      status: "failed",
      errorCode: "PAUSED",
      video: null,
    });
    // The capped step tried only its first route: no fallback attempt, so exactly one submit.
    const capped = stepsOf(h, spec.id).filter((s) =>
      s.attempts.some((a) => a.failKind === "key_daily_cap"),
    );
    expect(capped.length).toBeGreaterThan(0);
    for (const step of capped) expect(step.attempts).toHaveLength(1);
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

  it("still ends and refunds the video when pausing the site fails", async () => {
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(CAPPED) });
    const { spec, runner } = await h.readyStory();
    const put = h.kv.KV.put.bind(h.kv.KV);
    vi.spyOn(h.kv.KV, "put").mockImplementation(async (key, value, options) => {
      if (key === "flags") throw new Error("kv down");
      return put(key, value, options);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runner.render(HOLD);
    await h.advance(60_000);
    expect(await runner.view()).toMatchObject({
      status: "failed",
      errorCode: "PAUSED",
      video: null,
    });
    expect(h.wallet.calls).toEqual([["release", "u1", "r1", spec.id]]);
  });
});
