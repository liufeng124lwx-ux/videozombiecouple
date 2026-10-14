import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditGrant } from "../src/durable-objects/wallet.ts";
import { setup } from "./harness.ts";

const T0 = Date.UTC(2026, 9, 9, 12);
const DAY = 86_400_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

type Op =
  | { op: "grant"; kind: CreditGrant["kind"]; credits: number; days: number | null }
  | { op: "reserve"; credits: number }
  | { op: "commit"; pick: number; credits: number }
  | { op: "release"; pick: number }
  | { op: "wait"; hours: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    op: fc.constant("grant" as const),
    kind: fc.constantFrom("subscription", "pack", "bonus", "admin") as fc.Arbitrary<
      CreditGrant["kind"]
    >,
    credits: fc.integer({ min: 1, max: 20 }),
    days: fc.option(fc.integer({ min: 1, max: 10 }), { nil: null }),
  }),
  fc.record({ op: fc.constant("reserve" as const), credits: fc.integer({ min: 1, max: 12 }) }),
  fc.record({
    op: fc.constant("commit" as const),
    pick: fc.nat(),
    credits: fc.integer({ min: 0, max: 12 }),
  }),
  fc.record({ op: fc.constant("release" as const), pick: fc.nat() }),
  fc.record({ op: fc.constant("wait" as const), hours: fc.integer({ min: 1, max: 24 * 12 }) }),
);

describe("Wallet ledger properties (spec 11.1)", () => {
  it("never goes negative and every bucket equals the sum of its ledger rows", async () => {
    await fc.assert(
      // "max" size: fast-check otherwise favours short arrays, which rarely reach an expired refund.
      fc.asyncProperty(
        fc.array(opArb, { minLength: 10, maxLength: 40, size: "max" }),
        async (ops) => {
          vi.setSystemTime(T0);
          const h = await setup();
          const w = h.wallets.instance("u1");
          const reservations: string[] = [];
          for (const step of ops) {
            if (step.op === "grant") {
              await w.grant("u1", {
                kind: step.kind,
                credits: step.credits,
                expiresAt: step.days === null ? null : Date.now() + step.days * DAY,
                sourceRef: null,
                reason: "property",
              });
            } else if (step.op === "reserve") {
              const before = (await w.balance("u1")).total;
              const id = `r${reservations.length}`;
              const result = await w.reserve("u1", id, step.credits, id);
              const after = (await w.balance("u1")).total;
              if (result.ok) {
                reservations.push(id);
                expect(after).toBe(before - step.credits);
              } else {
                expect(before).toBeLessThan(step.credits);
                expect(after).toBe(before);
              }
            } else if (step.op === "commit" && reservations.length > 0) {
              const id = reservations[step.pick % reservations.length] as string;
              await w.commitReservation(id, step.credits, id);
            } else if (step.op === "release" && reservations.length > 0) {
              const id = reservations[step.pick % reservations.length] as string;
              await w.releaseReservation(id, id);
            } else if (step.op === "wait") {
              vi.setSystemTime(Date.now() + step.hours * 3_600_000);
            }
            const rows = h.db
              .prepare(
                "SELECT b.remaining AS remaining, COALESCE(SUM(l.delta), 0) AS total FROM credit_buckets b LEFT JOIN credit_ledger l ON l.bucket_id = b.id GROUP BY b.id",
              )
              .all() as { remaining: number; total: number }[];
            for (const row of rows) {
              expect(row.remaining).toBeGreaterThanOrEqual(0);
              expect(row.remaining).toBe(row.total);
            }
            expect((await w.balance("u1")).total).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
