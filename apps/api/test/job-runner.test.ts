import { ROUTES } from "@vzc/catalog";
import type { FakeStep } from "@vzc/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunnerView } from "../src/jobs/types.ts";
import { guestCounters, quotaStatus, reserveQuota } from "../src/services/quota.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const SEEDREAM = "seedream/5-flash-image-to-image";
const NB2 = "nano-banana-2";
const NBP = "nano-banana-pro";
const NSFW = "your content creation prompt contains NSFW, which isn't allowed under our policy.";
const DOWN = "internal error, please try again later.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

const harness = (script: Record<string, FakeStep[]> = {}) =>
  setup({ FAKE_SCRIPT: JSON.stringify(script) });
const states = (view: RunnerView | null) => view?.attempts.map((a) => [a.model, a.state]);
const credits = (reserved: number) =>
  ({ kind: "credits", userId: "u1", reservationId: "r1", reserved }) as const;

describe("JobRunner: standard tier (spec 4.1, 4.3)", () => {
  it("delivers the primary result into out/ and charges the standard tier", async () => {
    const h = await harness();
    const { spec, runner } = await h.job();
    expect((await runner.start(spec)).status).toBe("submitted");
    await h.advance(60_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std", errorCode: null });
    expect(states(view)).toEqual([[SEEDREAM, "succeeded"]]);
    expect(view?.attempts[0]?.outputKey).toBe(`out/${spec.id}/a1.png`);
    expect(h.r2.objects.has(`out/${spec.id}/a1.png`)).toBe(true);
  });

  it("polls first at the median time, then every 5 seconds", async () => {
    const h = await harness();
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(28_000);
    expect(await runner.view()).toMatchObject({ status: "submitted", etaMs: 1_000 });
    await h.advance(5_999); // 29s: still generating; next poll at 34s
    expect((await runner.view())?.status).toBe("submitted");
    await h.advance(1);
    expect((await runner.view())?.status).toBe("succeeded");
  });

  it("switches to the fallback when the primary rejects the photo", async () => {
    const h = await harness({ [SEEDREAM]: [{ kind: "fail", failMsg: NSFW }] });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(120_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(states(view)).toEqual([
      [SEEDREAM, "failed"],
      [NB2, "succeeded"],
    ]);
    expect(view?.attempts[0]?.failKind).toBe("content_rejected");
    expect(h.analytics.map((p) => p.blobs?.[2])).toEqual(["failed", "succeeded"]);
  });

  it("does not try the fallback when kie calls the request invalid", async () => {
    const h = await harness({
      [SEEDREAM]: [{ kind: "submit_error", code: 422, msg: "image could not be processed" }],
    });
    const { spec, runner } = await h.job();
    expect(await runner.start(spec)).toMatchObject({
      status: "failed",
      errorCode: "FILE_UNSUPPORTED",
    });
    expect(states(await runner.view())).toEqual([[SEEDREAM, "failed"]]);
  });

  it("ends with the code of the last failure when every route fails", async () => {
    const rejected = await harness({
      [SEEDREAM]: [{ kind: "fail", failMsg: DOWN }],
      [NB2]: [{ kind: "fail", failMsg: NSFW }],
    });
    const first = await rejected.job();
    await first.runner.start(first.spec);
    await rejected.advance(200_000);
    expect(await first.runner.view()).toMatchObject({
      status: "failed",
      errorCode: "CONTENT_REJECTED",
      chargedTier: null,
    });

    const down = await harness({
      [SEEDREAM]: [{ kind: "fail", failMsg: DOWN }],
      [NB2]: [{ kind: "fail", failMsg: DOWN }],
    });
    const second = await down.job();
    await second.runner.start(second.spec);
    await down.advance(200_000);
    expect((await second.runner.view())?.errorCode).toBe("PROVIDER_DOWN");
  });

  it("abandons a route at its timeout and moves on to the fallback", async () => {
    const h = await harness({ [SEEDREAM]: [{ kind: "never" }] });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(89_999);
    expect(states(await runner.view())).toEqual([[SEEDREAM, "pending"]]);
    await h.advance(1);
    expect(states(await runner.view())).toEqual([
      [SEEDREAM, "abandoned"],
      [NB2, "pending"],
    ]);
    await h.advance(70_000);
    const view = await runner.view();
    expect(view?.status).toBe("succeeded");
    expect(view?.attempts[0]?.failKind).toBe("timeout");
  });

  it("books the route's estimated cost for an abandoned call that was submitted", async () => {
    const h = await harness({ [SEEDREAM]: [{ kind: "never" }] });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(90_000);
    const row = h.db.prepare("SELECT attempts FROM jobs WHERE id=?").get(spec.id) as {
      attempts: string;
    };
    const [attempt] = JSON.parse(row.attempts) as {
      state: string;
      costUsd: number | null;
      costEstimated?: boolean;
      routeId: string;
    }[];
    expect(attempt?.state).toBe("abandoned");
    const route = ROUTES.find((r) => r.id === attempt?.routeId);
    expect(route?.costUsd).toBeGreaterThan(0);
    expect(attempt?.costUsd).toBe(route?.costUsd);
    expect(attempt?.costEstimated).toBe(true);
  });

  it("books the estimate when ops gives up on a submitted call that never reported back", async () => {
    const h = await harness({ [SEEDREAM]: [{ kind: "never" }] });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(30_000);
    expect(await runner.giveUp()).toBe("stopped");
    const row = h.db.prepare("SELECT attempts FROM jobs WHERE id=?").get(spec.id) as {
      attempts: string;
    };
    const [attempt] = JSON.parse(row.attempts) as {
      state: string;
      costUsd: number | null;
      costEstimated?: boolean;
      routeId: string;
    }[];
    expect(attempt?.state).toBe("abandoned");
    const route = ROUTES.find((r) => r.id === attempt?.routeId);
    expect(attempt?.costUsd).toBe(route?.costUsd);
    expect(attempt?.costEstimated).toBe(true);
  });

  it("books nothing for a call that failed at submit (no task id)", async () => {
    const h = await harness({
      [SEEDREAM]: [{ kind: "submit_error", code: 422, msg: "image could not be processed" }],
    });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(60_000);
    const row = h.db.prepare("SELECT attempts FROM jobs WHERE id=?").get(spec.id) as {
      attempts: string;
    };
    const [attempt] = JSON.parse(row.attempts) as { costUsd: number | null }[];
    expect(attempt?.costUsd).toBeNull();
  });

  it("puts a rate-limited submit back in the queue without using the fallback", async () => {
    const h = await harness({
      [SEEDREAM]: [{ kind: "submit_error", code: 429, msg: "slow down" }],
    });
    const { spec, runner } = await h.job();
    expect((await runner.start(spec)).status).toBe("queued");
    await h.advance(60_000);
    const view = await runner.view();
    expect(view?.status).toBe("succeeded");
    expect(states(view)).toEqual([[SEEDREAM, "succeeded"]]);
  });

  it("waits in the Dispatcher queue and reports its position", async () => {
    const h = await harness();
    const pool = h.dispatchers.instance("kie-image");
    for (let i = 0; i < 15; i++) await pool.acquire(`other${i}`, "free");
    const { spec, runner } = await h.job();
    expect(await runner.start(spec)).toMatchObject({ status: "queued", queuePosition: 1 });
    await h.advance(2_000);
    expect(await runner.view()).toMatchObject({ status: "submitted", queuePosition: null });
  });

  it("skips a model whose breaker is open", async () => {
    const h = await harness();
    const pool = h.dispatchers.instance("kie-image");
    for (let i = 0; i < 10; i++) await pool.report(SEEDREAM, false);
    const { spec, runner } = await h.job();
    await runner.start(spec);
    expect(states(await runner.view())).toEqual([[NB2, "pending"]]);
    await h.advance(120_000);
    expect((await runner.view())?.status).toBe("succeeded");
  });

  it("fails at once with PROVIDER_DOWN when every model is switched off", async () => {
    const h = await harness();
    const pool = h.dispatchers.instance("kie-image");
    for (let i = 0; i < 10; i++) {
      await pool.report(SEEDREAM, false);
      await pool.report(NB2, false);
    }
    const { spec, runner } = await h.job();
    expect(await runner.start(spec)).toMatchObject({
      status: "failed",
      errorCode: "PROVIDER_DOWN",
      attempts: [],
    });
  });

  it("checks right away when kie calls back", async () => {
    const h = await harness({
      [SEEDREAM]: [{ kind: "success", pendingPolls: 0, outputUrl: "https://fake.test/a.png" }],
    });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(1_000);
    await runner.poke();
    expect((await runner.view())?.status).toBe("succeeded");
  });

  it("writes progress to the jobs row", async () => {
    const h = await harness();
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(60_000);
    const row = h.db
      .prepare("SELECT status, attempts, charge, finished_at FROM jobs WHERE id=?")
      .get(spec.id) as { status: string; attempts: string; charge: string; finished_at: number };
    expect(row.status).toBe("succeeded");
    expect(JSON.parse(row.attempts)).toEqual([
      expect.objectContaining({ id: "a1", model: SEEDREAM, state: "succeeded", role: "primary" }),
    ]);
    expect(JSON.parse(row.charge)).toEqual({ kind: "none", tier: "std", credits: 0 });
    expect(row.finished_at).toBe(Date.UTC(2026, 9, 9, 12) + 34_000);
  });

  it("resubmits an attempt that crashed between the slot grant and the kie call", async () => {
    const h = await harness();
    const pool = h.dispatchers.instance("kie-image");
    for (let i = 0; i < 15; i++) await pool.acquire(`other${i}`, "free");
    const { spec, runner } = await h.job();
    await runner.start(spec);
    const stored = h.runners.entries.get(spec.id)?.store.data.get("state") as {
      attempts: { state: string }[];
    };
    (stored.attempts[0] as { state: string }).state = "submitting";
    h.runners.restart(spec.id);
    await h.advance(2_000);
    expect(states(await h.runners.instance(spec.id).view())).toEqual([[SEEDREAM, "pending"]]);
    await h.advance(60_000);
    expect((await h.runners.instance(spec.id).view())?.status).toBe("succeeded");
  });
});

describe("JobRunner: Pro and 4K (spec 3.7)", () => {
  it("shows the fast candidate first and charges Pro once Nano Banana Pro delivers", async () => {
    const h = await harness({
      [NBP]: [{ kind: "success", pendingPolls: 3, outputUrl: "https://fake.test/nbp.png" }],
    });
    const { spec, runner } = await h.job({
      capability: "unblur.pro",
      priority: "paid",
      charge: credits(3),
    });
    await runner.start(spec);
    await h.advance(34_000);
    const early = await runner.view();
    expect(early?.status).toBe("submitted");
    expect(states(early)).toEqual([
      [NBP, "pending"],
      [SEEDREAM, "succeeded"],
    ]);
    expect(h.wallet.calls).toEqual([]);
    await h.advance(20_000);
    expect(await runner.view()).toMatchObject({ status: "succeeded", chargedTier: "pro" });
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 3, spec.id]]);
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith("keep/")).sort()).toEqual([
      `keep/${spec.id}/a1.png`,
      `keep/${spec.id}/a2.png`,
    ]);
  });

  it("charges 1 credit when only the Seedream candidate delivers", async () => {
    const h = await harness({ [NBP]: [{ kind: "fail", failMsg: DOWN }] });
    const { spec, runner } = await h.job({ capability: "unblur.pro", charge: credits(3) });
    await runner.start(spec);
    await h.advance(60_000);
    expect(await runner.view()).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
  });

  it("falls back to Nano Banana 2 once when both candidates fail", async () => {
    const h = await harness({
      [NBP]: [{ kind: "fail", failMsg: DOWN }],
      [SEEDREAM]: [{ kind: "fail", failMsg: NSFW }],
    });
    const { spec, runner } = await h.job({ capability: "unblur.pro", charge: credits(3) });
    await runner.start(spec);
    await h.advance(120_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(states(view)).toEqual([
      [NBP, "failed"],
      [SEEDREAM, "failed"],
      [NB2, "succeeded"],
    ]);
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
  });

  it("downgrades 4K to Seedream when Nano Banana Pro 4K fails and charges 1 credit", async () => {
    const h = await harness({ [NBP]: [{ kind: "fail", failMsg: DOWN }] });
    const { spec, runner } = await h.job({ capability: "unblur.4k", charge: credits(6) });
    await runner.start(spec);
    await h.advance(200_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(states(view)).toEqual([
      [NBP, "failed"],
      [SEEDREAM, "succeeded"],
    ]);
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
  });
});

describe("JobRunner: settlement", () => {
  const counters = guestCounters({ visitorHash: "v", fpHash: null, ipSegmentHash: "i" });
  const quota = (nonce: string) =>
    ({ kind: "quota", nonce, counters: counters.map((c) => c.name) }) as const;

  it("commits the guest's quota when a result is delivered", async () => {
    const h = await harness();
    const env = h.env as unknown as Bindings;
    const { spec, runner } = await h.job();
    await reserveQuota(env, counters, spec.id);
    await runner.start({ ...spec, charge: quota(spec.id) });
    await h.advance(60_000);
    expect((await quotaStatus(env, counters)).remaining).toBe(1);
  });

  // Review focus 4: kie succeeded but the output never reached R2.
  it("never reports success without the output file, and gives the quota back", async () => {
    const h = await harness();
    const env = h.env as unknown as Bindings;
    const { spec, runner } = await h.job();
    await reserveQuota(env, counters, spec.id);
    await runner.start({ ...spec, charge: quota(spec.id) });
    await env.BUCKET.delete(spec.inputKey); // the fake "downloads" by copying the input
    await h.advance(200_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "failed", errorCode: "PROVIDER_DOWN", chargedTier: null });
    expect(view?.attempts.every((a) => a.outputKey === null)).toBe(true);
    expect([...h.r2.objects.keys()].some((k) => k.startsWith("out/"))).toBe(false);
    expect((await quotaStatus(env, counters)).remaining).toBe(2);
  });

  // Review focus 5: the wallet is briefly down when the job settles.
  it("retries settlement on its own schedule and settles exactly once", async () => {
    const h = await harness();
    const { spec, runner } = await h.job({ charge: credits(1) });
    await runner.start(spec);
    h.wallet.failures = 1;
    await h.advance(60_000);
    expect(h.wallet.calls).toEqual([]);
    expect(await runner.retry({ attemptId: "a1", reason: "thumbs_down" })).toEqual({
      ok: false,
      reason: "not_done",
    });
    await h.advance(60_000);
    expect(await runner.view()).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
  });

  // Final review: the runtime gives up on a throwing alarm after a few retries.
  it("keeps retrying settlement through a long wallet outage", async () => {
    const h = await harness();
    const { spec, runner } = await h.job({ charge: credits(1) });
    await runner.start(spec);
    h.wallet.failures = 10;
    await h.advance(6 * 3_600_000);
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
    expect((await runner.retry({ attemptId: "a1", reason: "thumbs_down" })).ok).toBe(true);
  });

  // Final review: a transient Dispatcher error while the job starts must not strand it.
  it("recovers a job whose start was interrupted by a Dispatcher error", async () => {
    const h = await harness();
    const pool = h.dispatchers.instance("kie-image");
    const acquire = pool.acquire.bind(pool);
    pool.acquire = async () => {
      throw new Error("Dispatcher overloaded");
    };
    const { spec, runner } = await h.job();
    await expect(runner.start(spec)).rejects.toThrow("Dispatcher overloaded");
    pool.acquire = acquire;
    h.runners.restart(spec.id);
    await h.advance(60_000);
    expect(await h.runners.instance(spec.id).view()).toMatchObject({ status: "succeeded" });
  });
});
