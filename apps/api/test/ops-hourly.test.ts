import { OPS, ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpired } from "../src/ops/cleanup.ts";
import { checkCostSpike } from "../src/ops/costs.ts";
import { checkHealth, healthCheck } from "../src/ops/health.ts";
import type { Bindings } from "../src/types.ts";
import { jpeg, setup } from "./harness.ts";
import { row } from "./rows.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

/** A finished story that expires at `expiresAt`. */
async function finished(h: Awaited<ReturnType<typeof setup>>, expiresAt: number) {
  const made = await h.story();
  h.db
    .prepare("UPDATE stories SET status='done', expires_at=? WHERE id=?")
    .run(expiresAt, made.spec.id);
  return made;
}

const statusOf = (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  (h.db.prepare("SELECT status FROM stories WHERE id=?").get(id) as { status: string }).status;

describe("expired stories (spec 3.4, 8.2)", () => {
  it("deletes an expired story's files, marks it expired, and leaves samples, assets and live stories alone", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const old = await finished(h, NOON - 1);
    const live = await finished(h, NOON + DAY);
    const running = await h.story();
    h.db.prepare("UPDATE stories SET expires_at=? WHERE id=?").run(NOON - 1, running.spec.id);
    for (const prefix of ["kf", "shot", "out"])
      await h.r2.BUCKET.put(`${prefix}/${old.spec.id}/a1`, "x");
    await h.r2.BUCKET.put("samples/health.jpg", "x");
    await h.r2.BUCKET.put("assets/music/cabin.mp3", "x");
    await cleanupExpired(env, NOON);
    expect([...h.r2.objects.keys()].sort()).toEqual(
      [
        live.spec.survivorKey,
        live.spec.infectedKey,
        running.spec.survivorKey,
        running.spec.infectedKey,
        "samples/health.jpg",
        "assets/music/cabin.mp3",
      ].sort(),
    );
    expect(statusOf(h, old.spec.id)).toBe("expired");
    expect(statusOf(h, live.spec.id)).toBe("done");
    expect(statusOf(h, running.spec.id)).toBe("previewing");
  });
});

describe("cleanup that hits a stuck file", () => {
  it("keeps going past a story whose files can't be deleted", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const stuck = await finished(h, NOON - 2);
    const next = await finished(h, NOON - 1);
    const del = h.r2.BUCKET.delete.bind(h.r2.BUCKET);
    (h.r2.BUCKET as unknown as { delete: (k: string) => Promise<void> }).delete = async (
      key: string,
    ) => {
      if (key === stuck.spec.survivorKey) throw new Error("R2 says no");
      await del(key);
    };
    // It still reports the failure (the cron turns that into an alert).
    await expect(cleanupExpired(env, NOON)).rejects.toThrow("1 expired stories");
    expect(statusOf(h, next.spec.id)).toBe("expired");
    expect(statusOf(h, stuck.spec.id)).not.toBe("expired");
  });
});

describe("cost spike (spec 8.3)", () => {
  it("alerts when today's spend passes twice the 7-day daily average", async () => {
    const h = await setup();
    const sent: string[] = [];
    const add = (createdAt: number, costUsd: number) =>
      row(h, { createdAt, attempts: [{ state: "succeeded", costUsd, finishedAt: createdAt }] });
    for (let d = 1; d <= OPS.costLookbackDays; d++) add(NOON - d * DAY, 10);
    add(NOON - 1000, 15);
    await checkCostSpike(
      h.env as unknown as Bindings,
      NOON,
      async (_e, text) => void sent.push(text),
    );
    expect(sent).toEqual([]);
    add(NOON - 500, 10);
    await checkCostSpike(
      h.env as unknown as Bindings,
      NOON,
      async (_e, text) => void sent.push(text),
    );
    expect(sent).toHaveLength(1);
  });
  it("stays quiet while the amounts are tiny, like staging's smoke stories ($0.02 vs $0.00)", async () => {
    const h = await setup();
    const sent: string[] = [];
    const add = (createdAt: number, costUsd: number) =>
      row(h, { createdAt, attempts: [{ state: "succeeded", costUsd, finishedAt: createdAt }] });
    for (let d = 1; d <= OPS.costLookbackDays; d++) add(NOON - d * DAY, 0.001);
    add(NOON - 1000, 0.02);
    await checkCostSpike(
      h.env as unknown as Bindings,
      NOON,
      async (_e, text) => void sent.push(text),
    );
    expect(sent).toEqual([]);
  });
});

describe("health check (spec 8.2)", () => {
  it("runs one real call on the sample and resolves when it comes back", async () => {
    const h = await setup();
    await h.r2.BUCKET.put("samples/health.jpg", jpeg(1024, 768));
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    h.kv.store.set("alert:health:keyframe", JSON.stringify({ at: 0, open: true }));
    expect(
      await healthCheck(h.env as unknown as Bindings, "keyframe", NOON, send, async () => {}),
    ).toBe(true);
    expect(sent).toEqual(["Resolved: Health check failed: keyframe"]);
  });

  it("alerts when the sample is missing or the call never finishes", async () => {
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify({}),
    });
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    expect(
      await healthCheck(h.env as unknown as Bindings, "keyframe", NOON, send, async () => {}),
    ).toBe(false);
    expect(sent[0]).toContain("samples/health.jpg");
  });

  it("alerts when the call never finishes in time", async () => {
    const never = Object.fromEntries(
      ROUTES.filter((r) => r.capability === "keyframe").map((r) => [r.model, [{ kind: "never" }]]),
    );
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(never) });
    await h.r2.BUCKET.put("samples/health.jpg", jpeg(1024, 768));
    const sent: string[] = [];
    let waits = 0;
    const ok = await healthCheck(
      h.env as unknown as Bindings,
      "keyframe",
      NOON,
      async (_e, text) => void sent.push(text),
      async () => void waits++,
    );
    expect(ok).toBe(false);
    expect(waits).toBe(Math.floor(OPS.healthTimeoutMs / OPS.healthPollMs) + 1);
    expect(sent[0]).toContain("no result");
  });

  it("never submits a describe route as a task (it is a synchronous chat call)", async () => {
    const marker = Object.fromEntries(
      ROUTES.map((r) => [
        r.model,
        r.capability === "describe"
          ? [{ kind: "submit_error", code: 500, msg: "DESCRIBE-SUBMITTED" }]
          : [{ kind: "success", pendingPolls: 0, outputUrl: "https://fake.test/out.png" }],
      ]),
    );
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(marker) });
    await h.r2.BUCKET.put("samples/health.jpg", jpeg(1024, 768));
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    const ok = await healthCheck(
      h.env as unknown as Bindings,
      "describe" as never,
      NOON,
      send,
      async () => {},
    );
    expect(ok).toBe(false);
    expect(sent.join("\n")).not.toContain("DESCRIBE-SUBMITTED");
    expect(sent.join("\n")).toContain("not a task");
    // The 6-hourly round checks keyframes and shots only.
    sent.length = 0;
    await checkHealth(h.env as unknown as Bindings, Date.UTC(2026, 9, 9, 0), send);
    expect(sent.join("\n")).not.toMatch(/describe/i);
  });
});
