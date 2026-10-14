import { BUDGETS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPaidBudget, paidLine } from "../src/ops/budgets.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { row } from "./rows.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;
const TODAY = NOON - (NOON % DAY);
const flags = (h: Awaited<ReturnType<typeof setup>>) => JSON.parse(h.kv.store.get("flags") ?? "{}");
const none = async () => {};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("paid budget (cost guardrails spec 3)", () => {
  it("uses the floor while there is no history, and 3x the 7-day average once there is", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    expect(await paidLine(env, NOON, {})).toBe(BUDGETS.paid.floorUsd);
    for (let d = 1; d <= 7; d++)
      row(h, {
        kind: "credits",
        createdAt: TODAY - d * DAY,
        attempts: [{ state: "succeeded", costUsd: 20, finishedAt: TODAY - d * DAY + 1000 }],
      });
    expect(await paidLine(env, NOON, {})).toBe(60);
  });

  it("warns at 80%, pauses new paid jobs at 100%, and never lifts the pause by itself", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    row(h, {
      kind: "credits",
      attempts: [{ state: "succeeded", costUsd: BUDGETS.paid.floorUsd * 0.85 }],
    });
    await checkPaidBudget(env, NOON, send);
    expect(flags(h).paidPaused).not.toBe(true);
    expect(sent.some((t) => /80%/.test(t))).toBe(true);
    row(h, {
      kind: "credits",
      attempts: [{ state: "succeeded", costUsd: BUDGETS.paid.floorUsd * 0.2 }],
    });
    await checkPaidBudget(env, NOON + 60_000, send);
    expect(flags(h)).toMatchObject({ paidPaused: true, paidPausedBy: "ops" });
    expect(sent.some((t) => t.startsWith("Resolved") && /80%/.test(t))).toBe(true);
    await checkPaidBudget(env, NOON + DAY, send);
    expect(flags(h).paidPaused).toBe(true);
  });

  it("records when ops paused paid jobs", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: BUDGETS.paid.floorUsd }] });
    await checkPaidBudget(env, NOON, none);
    expect(flags(h)).toMatchObject({ paidPaused: true, paidPausedBy: "ops", paidPausedAt: NOON });
  });

  it("resolves the pause alert once an admin resumed and spend is under the new line", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: BUDGETS.paid.floorUsd }] });
    await checkPaidBudget(env, NOON, send);
    expect(sent.some((t) => /Paid jobs paused/.test(t))).toBe(true);
    // The admin resumed with a higher limit for today.
    h.kv.store.set(
      "flags",
      JSON.stringify({
        paidPaused: false,
        paidLimit: { day: TODAY, usd: BUDGETS.paid.floorUsd * 3 },
      }),
    );
    await checkPaidBudget(env, NOON + 300_000, send);
    expect(sent.some((t) => t.startsWith("Resolved") && /Paid jobs paused/.test(t))).toBe(true);
  });

  it("keeps the pause alert open while paid jobs stay paused", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: BUDGETS.paid.floorUsd }] });
    await checkPaidBudget(env, NOON, send);
    // A new UTC day: spend is back under the line, but only an admin resumes.
    await checkPaidBudget(env, NOON + DAY, send);
    expect(sent.some((t) => t.startsWith("Resolved") && /Paid jobs paused/.test(t))).toBe(false);
  });

  it("respects the limit an admin set for today when resuming", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: 40 }] });
    h.kv.store.set(
      "flags",
      JSON.stringify({ paidPaused: false, paidLimit: { day: TODAY, usd: 80 } }),
    );
    await checkPaidBudget(env, NOON, none);
    expect(flags(h).paidPaused).not.toBe(true);
    h.kv.store.set("flags", JSON.stringify({ paidLimit: { day: TODAY - DAY, usd: 80 } }));
    await checkPaidBudget(env, NOON, none);
    expect(flags(h).paidPaused).toBe(true);
  });

  it("treats a malformed paidLimit as unset", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    expect(await paidLine(env, NOON, { paidLimit: "lots" })).toBe(BUDGETS.paid.floorUsd);
    expect(await paidLine(env, NOON, { paidLimit: { day: TODAY, usd: "x" } })).toBe(
      BUDGETS.paid.floorUsd,
    );
  });

  it("warns when the lines add up to more than the kie key's daily cap", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    h.kv.store.set("flags", JSON.stringify({ paidLimit: { day: TODAY, usd: 500 } }));
    await checkPaidBudget(env, NOON, async (_e, text) => void sent.push(text));
    expect(sent.some((t) => /kie key/i.test(t))).toBe(true);
  });
});
