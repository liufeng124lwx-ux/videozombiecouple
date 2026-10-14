import { ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStuck, stuckAfterMs } from "../src/ops/stuck.ts";
import type { Bindings } from "../src/types.ts";
import { jobBody, setup } from "./harness.ts";

const START = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

/** Every Standard route's calls stay pending forever. */
const NEVER = JSON.stringify(
  Object.fromEntries(
    ROUTES.filter((r) => r.capability === "unblur.std").map((r) => [
      r.model,
      [{ kind: "never" }, { kind: "never" }, { kind: "never" }],
    ]),
  ),
);

const status = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  h.db.prepare("SELECT status, error_code FROM jobs WHERE id=?").get(id) as {
    status: string;
    error_code: string | null;
  };

describe("stuck jobs (spec 8.2)", () => {
  it("allows for the primary and every fallback before calling a job stuck", () => {
    expect(stuckAfterMs("unblur.pro")).toBeGreaterThan(stuckAfterMs("unblur.std"));
    expect(stuckAfterMs("unblur.std")).toBeGreaterThanOrEqual(2 * 90_000);
  });

  it("wakes a stuck job first, and gives up on it (with a refund) the round after", async () => {
    const h = await setup({ FAKE_SCRIPT: NEVER });
    const env = h.env as unknown as Bindings;
    const { spec, runner } = await h.job();
    await runner.start(spec);
    // Its calls never finish, and its alarm got lost.
    const entry = h.runners.entries.get(spec.id);
    entry?.store.clearAlarm();
    const late = START + stuckAfterMs("unblur.std") + 1_000;
    vi.setSystemTime(late);
    await checkStuck(env, late, async () => {});
    expect(entry?.store.alarmAt()).not.toBeNull();
    vi.setSystemTime(late + 300_000);
    entry?.store.clearAlarm();
    await checkStuck(env, late + 300_000, async () => {});
    expect(status(h, spec.id)).toMatchObject({ status: "failed", error_code: "TIMEOUT" });
  });

  it("fails a job that never started, and says so", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const { spec } = await h.job();
    h.db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(spec.id);
    const late = START + stuckAfterMs("unblur.std") + 1_000;
    const sent: string[] = [];
    await checkStuck(env, late, async (_e, text) => void sent.push(text));
    await checkStuck(env, late + 300_000, async (_e, text) => void sent.push(text));
    expect(status(h, spec.id)).toMatchObject({ status: "failed", error_code: "TIMEOUT" });
    expect(sent.some((s) => s.includes(spec.id))).toBe(true);
  });

  it("leaves jobs that are still inside their time alone", async () => {
    const h = await setup();
    const { spec } = await h.job();
    h.db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(spec.id);
    await checkStuck(h.env as unknown as Bindings, START + 60_000, async () => {});
    await checkStuck(h.env as unknown as Bindings, START + 360_000, async () => {});
    expect(status(h, spec.id).status).toBe("queued");
  });

  it("gives a paid job's credits back when it gives up, even if the wallet fails at that moment", async () => {
    const all = Object.fromEntries(
      ROUTES.map((r) => [r.model, [{ kind: "never" }, { kind: "never" }, { kind: "never" }]]),
    );
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(all) });
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
    const created = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await h.upload(), { capability: "unblur.pro" }),
      session,
    });
    const jobId = created.body.jobId as string;
    expect((await wallet.balance(userId)).total).toBe(7);
    const entry = h.runners.entries.get(jobId);
    entry?.store.clearAlarm();
    const late = START + stuckAfterMs("unblur.pro") + 1_000;
    vi.setSystemTime(late);
    await checkStuck(env, late, async () => {});
    entry?.store.clearAlarm();
    vi.setSystemTime(late + 300_000);
    h.wallet.releaseFailures = 1;
    await checkStuck(env, late + 300_000, async () => {});
    expect(status(h, jobId)).toMatchObject({ status: "failed", error_code: "TIMEOUT" });
    await h.advance(10 * 60_000);
    expect((await wallet.balance(userId)).total).toBe(10);
  });
});
