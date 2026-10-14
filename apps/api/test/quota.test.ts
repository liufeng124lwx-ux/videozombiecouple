import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitQuota,
  previewCounters,
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

const account = (userId: string, ipSegmentHash = "ip1") => previewCounters(userId, ipSegmentHash);

describe("preview quota (spec 7)", () => {
  it("gives each account 3 previews a day", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    for (let i = 0; i < 3; i++) expect(await reserveQuota(e, account("u1"), `s${i}`)).toBe(true);
    expect(await reserveQuota(e, account("u1"), "s3")).toBe(false);
    expect(await reserveQuota(e, account("u2"), "s4")).toBe(true);
  });

  it("caps an IP segment at 10 across accounts", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    for (let i = 0; i < 10; i++)
      expect(await reserveQuota(e, account(`u${i}`), `s${i}`)).toBe(true);
    expect(await reserveQuota(e, account("u10"), "s10")).toBe(false);
  });

  it("takes nothing when any counter is full", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    for (let i = 0; i < 10; i++) await reserveQuota(e, account(`u${i}`), `s${i}`);
    expect(await reserveQuota(e, account("fresh"), "s10")).toBe(false);
    expect((await quotaStatus(e, account("fresh", "ip2"))).remaining).toBe(3);
  });

  // Final review: an error from one counter must not leave the others holding a use.
  it("gives back what it took when a counter fails", async () => {
    const h = await setup();
    const e = h.env as unknown as Bindings;
    const ip = h.limiters.instance("quota:preview:ip:ip1");
    ip.reserve = async () => {
      throw new Error("limiter unavailable");
    };
    await expect(reserveQuota(e, account("u1"), "s1")).rejects.toThrow("limiter unavailable");
    expect(await h.limiters.instance("quota:preview:user:u1").used()).toBe(0);
  });

  it("gives a use back when the preview fails and keeps it when it succeeds", async () => {
    const { env } = await setup();
    const e = env as unknown as Bindings;
    const counters = account("u1");
    const names = counters.map((c) => c.name);
    await reserveQuota(e, counters, "ok");
    await reserveQuota(e, counters, "bad");
    await commitQuota(e, names, "ok");
    await releaseQuota(e, names, "bad");
    expect(await quotaStatus(e, counters)).toEqual({
      remaining: 2,
      limit: 3,
      resetAt: Date.UTC(2026, 9, 10),
    });
  });
});

describe("GET /v1/quota", () => {
  it("tells a guest to sign in: previews need an account", async () => {
    const h = await setup();
    const first = await h.call("/v1/quota");
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ remaining: 0, limit: 0, resetAt: null, loginRequired: true });
  });
});
