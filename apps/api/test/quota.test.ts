import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitQuota,
  guestCounters,
  quotaStatus,
  releaseQuota,
  reserveQuota,
} from "../src/services/quota.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

const guest = (visitorHash: string, fpHash: string | null = null, ipSegmentHash = "ip1") =>
  guestCounters({ visitorHash, fpHash, ipSegmentHash });

describe("guest quota (spec 5.2)", () => {
  it("gives each cookie 2 uses a day", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    expect(await reserveQuota(e, guest("v1"), "j1")).toBe(true);
    expect(await reserveQuota(e, guest("v1"), "j2")).toBe(true);
    expect(await reserveQuota(e, guest("v1"), "j3")).toBe(false);
    expect(await reserveQuota(e, guest("v2"), "j4")).toBe(true);
  });

  it("caps a device fingerprint at 2 even across new cookies", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    expect(await reserveQuota(e, guest("v1", "fp"), "j1")).toBe(true);
    expect(await reserveQuota(e, guest("v2", "fp"), "j2")).toBe(true);
    expect(await reserveQuota(e, guest("v3", "fp"), "j3")).toBe(false);
  });

  it("caps an IP segment at 10 across cookies and devices", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    for (let i = 0; i < 10; i++)
      expect(await reserveQuota(e, guest(`v${i}`, `fp${i}`), `j${i}`)).toBe(true);
    expect(await reserveQuota(e, guest("v10", "fp10"), "j10")).toBe(false);
  });

  it("takes nothing when any counter is full", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    for (let i = 0; i < 10; i++) await reserveQuota(e, guest(`v${i}`), `j${i}`);
    expect(await reserveQuota(e, guest("fresh"), "j10")).toBe(false);
    expect((await quotaStatus(e, guest("fresh", null, "ip2"))).remaining).toBe(2);
  });

  // Final review: an error from one counter must not leave the others holding a use.
  it("gives back what it took when a counter fails", async () => {
    const h = await setup();
    const e = h.env as unknown as Bindings;
    const ip = h.limiters.instance("quota:ip:ip1");
    ip.reserve = async () => {
      throw new Error("limiter unavailable");
    };
    await expect(reserveQuota(e, guest("v1"), "j1")).rejects.toThrow("limiter unavailable");
    expect(await h.limiters.instance("quota:visitor:v1").used()).toBe(0);
  });

  it("gives a use back when the job fails and keeps it when it succeeds", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    const counters = guest("v1", "fp");
    const names = counters.map((c) => c.name);
    await reserveQuota(e, counters, "ok");
    await reserveQuota(e, counters, "bad");
    await commitQuota(e, names, "ok");
    await releaseQuota(e, names, "bad");
    expect(await quotaStatus(e, counters)).toEqual({
      remaining: 1,
      limit: 2,
      resetAt: Date.UTC(2026, 9, 10),
    });
  });
});

describe("GET /v1/quota", () => {
  it("reports today's remaining free uses for this browser", async () => {
    const h = await setup();
    const first = await h.call("/v1/quota");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ remaining: 2, limit: 2, resetAt: Date.UTC(2026, 9, 10) });
  });
});
