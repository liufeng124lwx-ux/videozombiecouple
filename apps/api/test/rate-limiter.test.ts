import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/durable-objects/rate-limiter.ts";
import { namespace } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

const limiters = () => namespace((ctx) => new RateLimiter(ctx, {} as never));

describe("RateLimiter.hit", () => {
  it("allows `limit` hits per window, then reports when the oldest hit expires", async () => {
    const limiter = limiters().instance("rate:x");
    for (let i = 0; i < 5; i++) {
      expect((await limiter.hit(5, 60_000)).allowed).toBe(true);
      vi.setSystemTime(Date.now() + 1_000);
    }
    expect(await limiter.hit(5, 60_000)).toEqual({ allowed: false, retryAfterSec: 55 });
    vi.setSystemTime(NOON + 60_001);
    expect((await limiter.hit(5, 60_000)).allowed).toBe(true);
  });
});

describe("RateLimiter daily holds (spec 5.2)", () => {
  it("reserves up to the limit and gives a use back on release", async () => {
    const limiter = limiters().instance("quota:visitor:v");
    expect(await limiter.reserve("job1", 2)).toEqual({ allowed: true, used: 1 });
    expect(await limiter.reserve("job2", 2)).toEqual({ allowed: true, used: 2 });
    expect(await limiter.reserve("job3", 2)).toEqual({ allowed: false, used: 2 });
    await limiter.release("job2");
    expect(await limiter.reserve("job3", 2)).toEqual({ allowed: true, used: 2 });
  });

  it("counts committed uses and treats a repeated nonce as the same hold", async () => {
    const limiter = limiters().instance("quota:visitor:v");
    await limiter.reserve("job1", 2);
    await limiter.commit("job1");
    expect(await limiter.reserve("job1", 2)).toEqual({ allowed: true, used: 1 });
    expect(await limiter.used()).toBe(1);
  });

  it("starts a fresh count at UTC midnight", async () => {
    const limiter = limiters().instance("quota:visitor:v");
    await limiter.reserve("job1", 2);
    await limiter.reserve("job2", 2);
    vi.setSystemTime(Date.UTC(2026, 9, 10, 0, 0, 1));
    expect(await limiter.used()).toBe(0);
    expect((await limiter.reserve("job3", 2)).allowed).toBe(true);
  });

  // Review focus 2: a job reserved before midnight and settled after it.
  it("settles a hold on the day it was reserved", async () => {
    const limiter = limiters().instance("quota:visitor:v");
    vi.setSystemTime(Date.UTC(2026, 9, 9, 23, 59, 50));
    await limiter.reserve("late", 2);
    vi.setSystemTime(Date.UTC(2026, 9, 10, 0, 0, 30));
    await limiter.commit("late");
    expect(await limiter.used()).toBe(0);
    expect((await limiter.reserve("a", 2)).allowed).toBe(true);
    expect((await limiter.reserve("b", 2)).allowed).toBe(true);
    // A hold released after midnight leaves no trace either.
    vi.setSystemTime(Date.UTC(2026, 9, 10, 23, 59, 50));
    await limiter.release("a");
    vi.setSystemTime(Date.UTC(2026, 9, 11, 0, 0, 30));
    expect(await limiter.used()).toBe(0);
  });

  it("keeps its counts across a restart", async () => {
    const ns = limiters();
    await ns.instance("quota:visitor:v").reserve("job1", 2);
    expect(await ns.restart("quota:visitor:v").used()).toBe(1);
  });
});

describe("RateLimiter weighted holds (cost guardrails spec 4)", () => {
  it("counts weights, refuses what would go over, and commits a smaller weight", async () => {
    const limiter = limiters().instance("spend:user:u");
    expect(await limiter.reserve("j1", 10, 6)).toEqual({ allowed: true, used: 6 });
    expect(await limiter.reserve("j2", 10, 6)).toEqual({ allowed: false, used: 6 });
    expect(await limiter.reserve("j2", 10, 4)).toEqual({ allowed: true, used: 10 });
    await limiter.commit("j1", 1);
    expect(await limiter.used()).toBe(5);
    expect(await limiter.reserve("j3", 10)).toEqual({ allowed: true, used: 6 });
  });
});
