import { OPS, ROUTES } from "@vzc/catalog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupExpired } from "../src/ops/cleanup.ts";
import { checkCostSpike } from "../src/ops/costs.ts";
import { healthCheck } from "../src/ops/health.ts";
import type { Bindings } from "../src/types.ts";
import { jpeg, setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("expired jobs (spec 1.3, 8.2)", () => {
  it("deletes an expired job's files, marks it expired, and leaves samples and live jobs alone", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const old = await h.job({ expiresAt: NOON - 1 });
    const live = await h.job({ expiresAt: NOON + DAY });
    await h.r2.BUCKET.put(`out/${old.spec.id}/a1.png`, "x");
    await h.r2.BUCKET.put(`keep/${old.spec.id}/a1.png`, "x");
    await h.r2.BUCKET.put("samples/health.jpg", "x");
    await cleanupExpired(env, NOON);
    expect([...h.r2.objects.keys()].sort()).toEqual(
      [live.spec.inputKey, "samples/health.jpg"].sort(),
    );
    const row = (id: string) =>
      (h.db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as { status: string }).status;
    expect(row(old.spec.id)).toBe("expired");
    expect(row(live.spec.id)).not.toBe("expired");
  });
});

describe("cleanup that hits a stuck file", () => {
  it("keeps going past a job whose files can't be deleted", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const stuck = await h.job({ expiresAt: NOON - 2 });
    const next = await h.job({ expiresAt: NOON - 1 });
    const del = h.r2.BUCKET.delete.bind(h.r2.BUCKET);
    (h.r2.BUCKET as unknown as { delete: (k: string) => Promise<void> }).delete = async (
      key: string,
    ) => {
      if (key === stuck.spec.inputKey) throw new Error("R2 says no");
      await del(key);
    };
    // It still reports the failure (the cron turns that into an alert).
    await expect(cleanupExpired(env, NOON)).rejects.toThrow("1 expired jobs");
    const row = (id: string) =>
      (h.db.prepare("SELECT status FROM jobs WHERE id=?").get(id) as { status: string }).status;
    expect(row(next.spec.id)).toBe("expired");
    expect(row(stuck.spec.id)).not.toBe("expired");
  });
});

describe("cost spike (spec 8.3)", () => {
  it("alerts when today's spend passes twice the 7-day daily average", async () => {
    const h = await setup();
    const sent: string[] = [];
    const add = (createdAt: number, costUsd: number) =>
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,attempts,charge,priority,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `J${createdAt}${costUsd}`,
          "g",
          "v",
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "1",
          "in/x.jpg",
          "{}",
          "{}",
          "succeeded",
          JSON.stringify([{ state: "succeeded", costUsd }]),
          '{"kind":"quota"}',
          "free",
          `k${createdAt}${costUsd}`,
          createdAt,
          createdAt + DAY,
        );
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
  it("stays quiet while the amounts are tiny, like staging's smoke jobs ($0.02 vs $0.00)", async () => {
    const h = await setup();
    const sent: string[] = [];
    const add = (createdAt: number, costUsd: number) =>
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,attempts,charge,priority,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `J${createdAt}${costUsd}`,
          "g",
          "v",
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "1",
          "in/x.jpg",
          "{}",
          "{}",
          "succeeded",
          JSON.stringify([{ state: "succeeded", costUsd }]),
          '{"kind":"quota"}',
          "free",
          `k${createdAt}${costUsd}`,
          createdAt,
          createdAt + DAY,
        );
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
  it("runs one real job on the sample and resolves when it comes back", async () => {
    const h = await setup();
    await h.r2.BUCKET.put("samples/health.jpg", jpeg(1024, 768));
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    h.kv.store.set("alert:health:unblur.std", JSON.stringify({ at: 0, open: true }));
    expect(
      await healthCheck(h.env as unknown as Bindings, "unblur.std", NOON, send, async () => {}),
    ).toBe(true);
    expect(sent).toEqual(["Resolved: Health check failed: unblur.std"]);
  });

  it("alerts when the sample is missing or the job never finishes", async () => {
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify({}),
    });
    const sent: string[] = [];
    const send = async (_e: Bindings, text: string) => void sent.push(text);
    expect(
      await healthCheck(h.env as unknown as Bindings, "unblur.std", NOON, send, async () => {}),
    ).toBe(false);
    expect(sent[0]).toContain("samples/health.jpg");
  });

  it("alerts when the job never finishes in time", async () => {
    const never = Object.fromEntries(
      ROUTES.filter((r) => r.capability === "unblur.std").map((r) => [
        r.model,
        [{ kind: "never" }],
      ]),
    );
    const h = await setup({ FAKE_SCRIPT: JSON.stringify(never) });
    await h.r2.BUCKET.put("samples/health.jpg", jpeg(1024, 768));
    const sent: string[] = [];
    let waits = 0;
    const ok = await healthCheck(
      h.env as unknown as Bindings,
      "unblur.std",
      NOON,
      async (_e, text) => void sent.push(text),
      async () => void waits++,
    );
    expect(ok).toBe(false);
    expect(waits).toBe(Math.floor(OPS.healthTimeoutMs / OPS.healthPollMs) + 1);
    expect(sent[0]).toContain("no result");
  });
});
