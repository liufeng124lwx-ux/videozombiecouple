import { BUDGETS, OPS } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRONS, runCron } from "../src/ops/cron.ts";
import { checkFailures } from "../src/ops/failures.ts";
import { checkFreeTier } from "../src/ops/free-tier.ts";
import { spendBetween } from "../src/ops/spend.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";
import { row } from "./rows.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("free-tier cost breaker (spec 4.2)", () => {
  it("pauses free jobs once today's free spend reaches the cap, and lifts it the next day", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    row(h, { attempts: [{ state: "succeeded", costUsd: BUDGETS.free.dailyUsd - 1 }] });
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: 100 }] });
    await checkFreeTier(env, NOON, send);
    expect(JSON.parse(h.kv.store.get("flags") ?? "{}").freePaused).not.toBe(true);
    row(h, {
      attempts: [
        { state: "failed", costUsd: 0.5 },
        { state: "succeeded", costUsd: 0.5 },
      ],
    });
    await checkFreeTier(env, NOON + 300_000, send);
    expect(JSON.parse(h.kv.store.get("flags") ?? "{}")).toMatchObject({
      freePaused: true,
      freePausedBy: "ops",
    });
    expect(sent).toHaveLength(1);
    await checkFreeTier(env, NOON + 86_400_000, send);
    expect(JSON.parse(h.kv.store.get("flags") ?? "{}")).toMatchObject({ freePaused: false });
    expect(sent.at(-1)).toContain("Resolved");
  });

  it("never lifts a pause the admin set by hand", async () => {
    const h = await setup();
    h.kv.store.set("flags", JSON.stringify({ freePaused: true, banner: null }));
    await checkFreeTier(h.env as unknown as Bindings, NOON, async () => {});
    expect(JSON.parse(h.kv.store.get("flags") ?? "{}")).toMatchObject({ freePaused: true });
  });
});

describe("failure-rate alert (spec 8.3)", () => {
  it("alerts when a capability fails more than the limit in the window, with enough attempts", async () => {
    const h = await setup();
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    for (let i = 0; i < OPS.failureMinAttempts; i++)
      row(h, {
        capability: "unblur.pro",
        attempts: [{ state: i < 3 ? "failed" : "succeeded", costUsd: 0 }],
      });
    row(h, { capability: "unblur.std", attempts: [{ state: "failed", costUsd: 0 }] });
    await checkFailures(h.env as unknown as Bindings, NOON, send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("unblur.pro");
  });
});

describe("failure-rate alert ignores calls still in flight", () => {
  it("still alerts when calls hang, and counts only ended calls", async () => {
    const h = await setup();
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    for (let i = 0; i < OPS.failureMinAttempts; i++)
      row(h, { capability: "unblur.pro", attempts: [{ state: "failed", costUsd: 0 }] });
    for (let i = 0; i < 20; i++)
      row(h, { capability: "unblur.pro", attempts: [{ state: "pending", costUsd: 0 }] });
    await checkFailures(h.env as unknown as Bindings, NOON, send);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(`${OPS.failureMinAttempts} of ${OPS.failureMinAttempts} calls`);
  });
});

describe("failure-rate alert ignores the kie key's daily cap", () => {
  it("does not count calls refused by the cap, which has its own alert", async () => {
    const h = await setup();
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    for (let i = 0; i < OPS.failureMinAttempts; i++)
      row(h, {
        capability: "unblur.pro",
        attempts: [{ state: "failed", costUsd: 0, failKind: "key_daily_cap" }],
      });
    row(h, { capability: "unblur.pro", attempts: [{ state: "succeeded", costUsd: 0 }] });
    await checkFailures(h.env as unknown as Bindings, NOON, send);
    expect(sent).toEqual([]);
  });
});

describe("cron entry (spec 8.2)", () => {
  it("runs each schedule's tasks, and one failing task only raises an alert", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const sent: string[] = [];
    const ran = await runCron(
      CRONS.fiveMinutes,
      env,
      NOON,
      async (_e, text) => void sent.push(text),
    );
    expect(ran).toEqual(expect.arrayContaining(["free-tier", "failures", "stuck"]));
    (env as unknown as { DB: unknown }).DB = {
      prepare: () => {
        throw new Error("D1 down");
      },
    };
    const again = await runCron(
      CRONS.fiveMinutes,
      env,
      NOON + 300_000,
      async (_e, text) => void sent.push(text),
    );
    expect(again).not.toContain("free-tier");
    expect(again).not.toContain("failures");
    expect(sent.some((s) => s.includes("Ops task failed"))).toBe(true);
    expect(await runCron("1 2 3 4 5", env, NOON)).toEqual([]);
  });
});

describe("spend by when calls finish (cost guardrails spec 5)", () => {
  it("counts a call in the day it finished, not the day its job was created", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const today = NOON - (NOON % 86_400_000);
    row(h, {
      createdAt: today - 60_000,
      attempts: [{ state: "succeeded", costUsd: 1, finishedAt: today + 60_000 }],
    });
    expect(await spendBetween(env, today)).toBe(1);
    expect(await spendBetween(env, today - 86_400_000, today)).toBe(0);
  });

  it("splits free and paid spend", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    row(h, { kind: "quota", attempts: [{ state: "succeeded", costUsd: 2 }] });
    row(h, { kind: "credits", attempts: [{ state: "succeeded", costUsd: 5 }] });
    const today = NOON - (NOON % 86_400_000);
    expect(await spendBetween(env, today, undefined, "free")).toBe(2);
    expect(await spendBetween(env, today, undefined, "paid")).toBe(5);
    expect(await spendBetween(env, today)).toBe(7);
  });
});
