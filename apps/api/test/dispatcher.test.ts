import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dispatcher } from "../src/durable-objects/dispatcher.ts";
import { namespace } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const pool = () => namespace((ctx) => new Dispatcher(ctx, {} as never)).instance("kie-image");
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

/** Spends the whole bucket on free tickets, so the next requests have to wait. */
async function drain(d: Dispatcher, prefix = "drain") {
  for (let i = 0; i < 15; i++)
    expect(await d.acquire(`${prefix}${i}`, "free")).toEqual({ granted: true });
}

/** Puts 60 tickets in flight, refilling the bucket between batches. */
async function fill(d: Dispatcher) {
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 15; i++) await d.acquire(`r${round}-${i}`, "free");
    later(10_000);
  }
}

describe("Dispatcher rate (spec 4.2)", () => {
  it("grants 15 at once, then one more as soon as the bucket refills", async () => {
    const d = pool();
    await drain(d);
    expect(await d.acquire("next", "free")).toEqual({ granted: false, position: 1 });
    later(700); // 15 tokens per 10s → 1.05 tokens
    expect(await d.acquire("next", "free")).toEqual({ granted: true });
  });

  it("never has more than 60 in flight", async () => {
    const d = pool();
    await fill(d);
    expect(await d.acquire("extra", "paid")).toEqual({ granted: false, position: 1 });
    await d.release("r0-0");
    expect(await d.acquire("extra", "paid")).toEqual({ granted: true });
  });

  it("is idempotent for a ticket that was already granted", async () => {
    const d = pool();
    expect(await d.acquire("t", "free")).toEqual({ granted: true });
    for (let i = 0; i < 14; i++) await d.acquire(`o${i}`, "free");
    expect(await d.acquire("t", "free")).toEqual({ granted: true });
    expect(await d.acquire("late", "free")).toEqual({ granted: false, position: 1 });
  });
});

describe("Dispatcher queue order (spec 4.2)", () => {
  it("serves paid jobs first but lets one free job through after every 4 paid", async () => {
    const d = pool();
    await drain(d);
    await d.acquire("f1", "free");
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) await d.acquire(id, "paid");
    expect(await d.acquire("p1", "paid")).toEqual({ granted: false, position: 1 });
    expect(await d.acquire("f1", "free")).toEqual({ granted: false, position: 5 });
    expect(await d.acquire("p5", "paid")).toEqual({ granted: false, position: 6 });
    later(700);
    expect(await d.acquire("f1", "free")).toEqual({ granted: false, position: 5 });
    expect(await d.acquire("p1", "paid")).toEqual({ granted: true });
  });

  it("drops waiting tickets whose runner stopped asking", async () => {
    const d = pool();
    await fill(d);
    await d.acquire("gone", "free");
    expect(await d.acquire("alive", "free")).toEqual({ granted: false, position: 2 });
    later(31_000);
    expect(await d.acquire("alive", "free")).toEqual({ granted: false, position: 1 });
  });
});

describe("Dispatcher model breaker (spec 4.2)", () => {
  const M = "seedream/5-flash-image-to-image";

  it("needs 10 samples and more than half failing before it opens", async () => {
    const d = pool();
    for (let i = 0; i < 9; i++) await d.report(M, false);
    expect(await d.allowModels([M, "other"])).toEqual([M, "other"]);
    await d.report(M, false);
    expect(await d.allowModels([M, "other"])).toEqual(["other"]);
  });

  it("does not open at exactly half failing", async () => {
    const d = pool();
    for (let i = 0; i < 10; i++) await d.report(M, i % 2 === 0);
    expect(await d.allowModels([M])).toEqual([M]);
  });

  it("lets one probe through after 5 minutes and closes when it succeeds", async () => {
    const d = pool();
    for (let i = 0; i < 10; i++) await d.report(M, false);
    later(5 * 60_000 - 1);
    expect(await d.allowModels([M])).toEqual([]);
    later(1);
    expect(await d.allowModels([M])).toEqual([M]);
    expect(await d.acquire("probe", "free", M)).toEqual({ granted: true });
    expect(await d.allowModels([M])).toEqual([]);
    await d.report(M, true);
    expect(await d.allowModels([M])).toEqual([M]);
    expect(await d.allowModels([M])).toEqual([M]);
  });

  it("stays open for another cooldown when the probe fails", async () => {
    const d = pool();
    for (let i = 0; i < 10; i++) await d.report(M, false);
    later(5 * 60_000);
    await d.acquire("probe", "free", M);
    await d.report(M, false);
    expect(await d.allowModels([M])).toEqual([]);
    later(5 * 60_000);
    expect(await d.allowModels([M])).toEqual([M]);
  });

  // Final review: a fallback model that a job only planned must not use up the probe.
  it("spends the probe only when a slot is granted for that model", async () => {
    const d = pool();
    for (let i = 0; i < 10; i++) await d.report(M, false);
    later(5 * 60_000);
    expect(await d.allowModels([M])).toEqual([M]);
    expect(await d.allowModels([M])).toEqual([M]);
    await d.acquire("other-model", "free", "other");
    expect(await d.allowModels([M])).toEqual([M]);
  });

  it("ignores late reports from jobs that started before it opened", async () => {
    const d = pool();
    for (let i = 0; i < 10; i++) await d.report(M, false);
    await d.report(M, true);
    expect(await d.allowModels([M])).toEqual([]);
  });
});
