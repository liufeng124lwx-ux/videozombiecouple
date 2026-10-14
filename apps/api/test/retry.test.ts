import { CAPABILITIES } from "@vzc/catalog";
import { planRoutes, seedRoutes } from "@vzc/providers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryRoute } from "../src/jobs/retry-route.ts";
import type { RunnerView } from "../src/jobs/types.ts";
import { retryAllowed } from "../src/services/free-retry.ts";
import { setup } from "./harness.ts";

const SEEDREAM = "seedream/5-flash-image-to-image";
const NB2 = "nano-banana-2";
const NBP = "nano-banana-pro";
const DOWN = "internal error, please try again later.";
const NOON = Date.UTC(2026, 9, 9, 12);
const GUARD = {
  composition: 0.71,
  colorDeltaE: 4,
  faces: { expected: 1, matched: 0 },
  passed: false,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

const states = (view: RunnerView | null) => view?.attempts.map((a) => [a.model, a.state]);
const credits = (reserved: number) =>
  ({ kind: "credits", userId: "u1", reservationId: "r1", reserved }) as const;

describe("retryRoute (spec 3.7)", () => {
  const plan = (capability: keyof typeof CAPABILITIES) =>
    planRoutes(seedRoutes(), capability, "auto");

  it("uses a route the standard job has not used yet", () => {
    const used = new Set(["unblur.std:seedream-2k:1"]);
    expect(retryRoute("unblur.std", plan("unblur.std"), used).model).toBe(NB2);
  });

  it("reruns the primary when every standard route was used", () => {
    const used = new Set(["unblur.std:seedream-2k:1", "unblur.std:nano-banana-2-1k:2"]);
    expect(retryRoute("unblur.std", plan("unblur.std"), used).model).toBe(SEEDREAM);
  });

  it("reruns Nano Banana Pro for Pro and Nano Banana Pro 4K for 4K, never a cheaper model", () => {
    const pro = retryRoute("unblur.pro", plan("unblur.pro"), new Set());
    expect(pro.id).toBe("unblur.pro:nano-banana-pro-2k:1");
    const k4 = retryRoute(
      "unblur.4k",
      plan("unblur.4k"),
      new Set(["unblur.4k:nano-banana-pro-4k:1"]),
    );
    expect(k4.id).toBe("unblur.4k:nano-banana-pro-4k:1");
  });
});

describe("JobRunner.retry", () => {
  async function done(
    capability: "unblur.std" | "unblur.pro" | "unblur.4k" = "unblur.std",
    script = {},
  ) {
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(script) });
    const { spec, runner } = await h.job({ capability, charge: credits(6) });
    await runner.start(spec);
    await h.advance(200_000);
    expect((await runner.view())?.status).toBe("succeeded");
    return { h, spec, runner };
  }

  it("adds a free version from Nano Banana 2 without charging again", async () => {
    const { h, spec, runner } = await done();
    expect(await runner.retry({ attemptId: "a1", reason: "guard", guard: GUARD })).toEqual({
      ok: true,
    });
    expect((await runner.view())?.status).toBe("submitted");
    await h.advance(120_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std" });
    expect(states(view)).toEqual([
      [SEEDREAM, "succeeded"],
      [NB2, "succeeded"],
    ]);
    expect(view?.attempts[1]).toMatchObject({ role: "retry", freeRetry: true });
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
    const row = h.db.prepare("SELECT attempts FROM jobs WHERE id=?").get(spec.id) as {
      attempts: string;
    };
    expect(JSON.parse(row.attempts)[0].guard).toEqual(GUARD);
  });

  it("allows one free retry per job", async () => {
    const { h, runner } = await done();
    await runner.retry({ attemptId: "a1", reason: "thumbs_down", feedback: "face" });
    expect(await runner.retry({ attemptId: "a1", reason: "thumbs_down" })).toEqual({
      ok: false,
      reason: "used",
    });
    await h.advance(120_000);
    expect(await runner.retry({ attemptId: "a2", reason: "thumbs_down" })).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("refuses failed jobs and unknown attempts", async () => {
    const failed = await setup({
      FAKE_SCRIPT: JSON.stringify({
        [SEEDREAM]: [{ kind: "submit_error", code: 422, msg: "image could not be processed" }],
      }),
    });
    const { spec, runner } = await failed.job();
    await runner.start(spec);
    expect(await runner.retry({ attemptId: "a1", reason: "guard", guard: GUARD })).toEqual({
      ok: false,
      reason: "not_done",
    });
    const { runner: ok } = await done();
    expect(await ok.retry({ attemptId: "a9", reason: "thumbs_down" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("keeps the job succeeded when the free retry itself fails", async () => {
    const { h, spec, runner } = await done("unblur.std", {
      [NB2]: [{ kind: "fail", failMsg: DOWN }],
    });
    await runner.retry({ attemptId: "a1", reason: "thumbs_down" });
    await h.advance(120_000);
    const view = await runner.view();
    expect(view).toMatchObject({ status: "succeeded", chargedTier: "std", errorCode: null });
    expect(states(view)).toEqual([
      [SEEDREAM, "succeeded"],
      [NB2, "failed"],
    ]);
    expect(h.wallet.calls).toEqual([["commit", "u1", "r1", 1, spec.id]]);
  });

  it("reruns Nano Banana Pro for a Pro job", async () => {
    const { h, runner } = await done("unblur.pro");
    await runner.retry({ attemptId: "a1", reason: "guard", guard: GUARD });
    await h.advance(200_000);
    const view = await runner.view();
    expect(states(view)?.[2]).toEqual([NBP, "succeeded"]);
    expect(view?.chargedTier).toBe("pro");
  });
});

describe("retryAllowed (spec 3.7)", () => {
  async function rows(
    entries: {
      owner?: string;
      visitor?: string;
      fp?: string | null;
      retriedAt?: number | null;
      createdAt?: number;
    }[],
  ) {
    const h = await setup();
    entries.forEach((e, i) => {
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,fp_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,free_retry,retried_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `job${i}`,
          e.owner ?? "g:o",
          e.visitor ?? "v",
          e.fp ?? null,
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "p",
          `in/${i}.jpg`,
          "{}",
          "{}",
          "succeeded",
          "{}",
          "free",
          `k${i}`,
          e.retriedAt ? 1 : 0,
          e.retriedAt ?? null,
          e.createdAt ?? NOON - 1_000_000 + i,
          NOON + 86_400_000,
        );
    });
    return h.env.DB as D1Database;
  }
  const YESTERDAY = NOON - 86_400_000;

  it("allows 3 free retries per browser per UTC day", async () => {
    const db = await rows([
      { retriedAt: NOON - 3 },
      { retriedAt: NOON - 2 },
      { retriedAt: NOON - 1 },
    ]);
    expect(
      await retryAllowed(db, { owner: "g:o", userId: null, visitorHash: "v", fpHash: null }),
    ).toBe(false);
    expect(
      await retryAllowed(db, { owner: "g:x", userId: null, visitorHash: "other", fpHash: null }),
    ).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 9, 10, 0, 0, 1));
    expect(
      await retryAllowed(db, { owner: "g:o", userId: null, visitorHash: "v", fpHash: null }),
    ).toBe(true);
  });

  it("counts a device fingerprint across cookies", async () => {
    const db = await rows([
      { visitor: "a", fp: "f", retriedAt: NOON - 3 },
      { visitor: "b", fp: "f", retriedAt: NOON - 2 },
      { visitor: "c", fp: "f", retriedAt: NOON - 1 },
    ]);
    expect(
      await retryAllowed(db, { owner: "g:d", userId: null, visitorHash: "d", fpHash: "f" }),
    ).toBe(false);
  });

  it("ignores the retry rate until there are 10 jobs", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ retriedAt: i < 3 ? YESTERDAY : null }));
    expect(
      await retryAllowed(await rows(nine), {
        owner: "g:o",
        userId: null,
        visitorHash: "v",
        fpHash: null,
      }),
    ).toBe(true);
  });

  it("refuses when this retry would push the last 20 jobs above 30%", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ retriedAt: i < 3 ? YESTERDAY : null }));
    expect(
      await retryAllowed(await rows(ten), {
        owner: "g:o",
        userId: null,
        visitorHash: "v",
        fpHash: null,
      }),
    ).toBe(false);
    const twenty = (retried: number) =>
      Array.from({ length: 20 }, (_, i) => ({ retriedAt: i < retried ? YESTERDAY : null }));
    expect(
      await retryAllowed(await rows(twenty(5)), {
        owner: "g:o",
        userId: null,
        visitorHash: "v",
        fpHash: null,
      }),
    ).toBe(true);
    expect(
      await retryAllowed(await rows(twenty(6)), {
        owner: "g:o",
        userId: null,
        visitorHash: "v",
        fpHash: null,
      }),
    ).toBe(false);
  });
});

// Final review: Workers does not serialize RPC calls that await subrequests.
describe("JobRunner concurrency", () => {
  it("grants only one of two retries that arrive together", async () => {
    const h = await setup();
    const { spec, runner } = await h.job();
    await runner.start(spec);
    await h.advance(60_000);
    const results = await Promise.all([
      runner.retry({ attemptId: "a1", reason: "thumbs_down" }),
      runner.retry({ attemptId: "a1", reason: "thumbs_down" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await runner.view())?.attempts.filter((a) => a.freeRetry)).toHaveLength(1);
  });

  it("polls an attempt once when a kie callback and the alarm arrive together", async () => {
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify({
        "seedream/5-flash-image-to-image": [
          { kind: "success", pendingPolls: 0, outputUrl: "https://fake.test/a.png" },
        ],
      }),
    });
    const { spec, runner } = await h.job();
    await runner.start(spec);
    vi.setSystemTime(Date.now() + 29_000);
    await Promise.all([runner.poke(), runner.alarm()]);
    expect(h.analytics).toHaveLength(1);
    expect((await runner.view())?.status).toBe("succeeded");
  });
});
