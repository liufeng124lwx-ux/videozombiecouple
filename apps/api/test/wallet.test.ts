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

const grant = (overrides: Partial<CreditGrant> = {}): CreditGrant => ({
  kind: "pack",
  credits: 10,
  expiresAt: null,
  sourceRef: null,
  reason: "test",
  ...overrides,
});

async function wallet() {
  const h = await setup();
  const w = h.wallets.instance("u1");
  const buckets = () =>
    h.db.prepare("SELECT kind, remaining FROM credit_buckets ORDER BY created_at, id").all() as {
      kind: string;
      remaining: number;
    }[];
  /** Spec 5.3: for every bucket, remaining = SUM(ledger.delta). */
  const consistent = () =>
    h.db
      .prepare(
        "SELECT b.remaining AS remaining, COALESCE(SUM(l.delta), 0) AS total FROM credit_buckets b LEFT JOIN credit_ledger l ON l.bucket_id = b.id GROUP BY b.id",
      )
      .all()
      .every(
        (row) =>
          (row as { remaining: number; total: number }).remaining ===
          (row as { total: number }).total,
      );
  const types = () =>
    h.db
      .prepare("SELECT type FROM credit_ledger ORDER BY id")
      .all()
      .map((row) => (row as { type: string }).type);
  return { h, w, buckets, consistent, types };
}

describe("Wallet (spec 5.3)", () => {
  it("grants credits once per source", async () => {
    const { w } = await wallet();
    expect((await w.grant("u1", grant({ sourceRef: "order-1", credits: 60 }))).created).toBe(true);
    expect((await w.grant("u1", grant({ sourceRef: "order-1", credits: 60 }))).created).toBe(false);
    expect(await w.balance("u1")).toEqual({ total: 60, subscription: null, permanent: 60 });
  });

  it("spends subscription credits first, then the oldest other credits", async () => {
    const { w, buckets, consistent } = await wallet();
    await w.grant("u1", grant({ kind: "pack", credits: 10 }));
    vi.setSystemTime(T0 + 1_000);
    await w.grant("u1", grant({ kind: "subscription", credits: 5, expiresAt: T0 + 30 * DAY }));
    vi.setSystemTime(T0 + 2_000);
    await w.grant("u1", grant({ kind: "bonus", credits: 5 }));
    expect(await w.reserve("u1", "job1", 12, "job1")).toEqual({ ok: true });
    expect(buckets()).toEqual([
      { kind: "pack", remaining: 3 },
      { kind: "subscription", remaining: 0 },
      { kind: "bonus", remaining: 5 },
    ]);
    expect(consistent()).toBe(true);
  });

  it("refuses a reservation it cannot cover and changes nothing", async () => {
    const { w, types } = await wallet();
    await w.grant("u1", grant({ credits: 5 }));
    expect(await w.reserve("u1", "job1", 6, "job1")).toEqual({ ok: false, balance: 5 });
    expect(types()).toEqual(["grant"]);
  });

  it("keeps the charge on commit and gives back what was not charged", async () => {
    const { w, types, consistent } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    await w.reserve("u1", "pro", 3, "pro");
    await w.commitReservation("pro", 3, "pro");
    expect((await w.balance("u1")).total).toBe(7);
    await w.reserve("u1", "downgraded", 3, "downgraded");
    await w.commitReservation("downgraded", 1, "downgraded");
    expect((await w.balance("u1")).total).toBe(6);
    expect(types()).toEqual(["grant", "reserve", "commit", "reserve", "commit", "release"]);
    expect(consistent()).toBe(true);
  });

  it("returns everything on release, once", async () => {
    const { w } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    await w.reserve("u1", "job1", 3, "job1");
    await w.releaseReservation("job1", "job1");
    await w.releaseReservation("job1", "job1");
    await w.commitReservation("job1", 3, "job1");
    expect((await w.balance("u1")).total).toBe(10);
  });

  // Review focus 2: the bucket expired while the job ran, then the job failed.
  it("refunds into a new 30-day bonus when the original bucket has expired", async () => {
    const { h, w, consistent } = await wallet();
    await w.grant("u1", grant({ kind: "subscription", credits: 5, expiresAt: T0 + 3_600_000 }));
    await w.reserve("u1", "job1", 3, "job1");
    vi.setSystemTime(T0 + 2 * 3_600_000);
    await w.releaseReservation("job1", "job1");
    expect(await w.balance("u1")).toEqual({ total: 3, subscription: null, permanent: 3 });
    expect(
      h.db
        .prepare("SELECT kind, remaining, expires_at FROM credit_buckets WHERE kind='bonus'")
        .get(),
    ).toEqual({ kind: "bonus", remaining: 3, expires_at: T0 + 2 * 3_600_000 + 30 * DAY });
    expect(consistent()).toBe(true);
  });

  it("does not spend expired credits", async () => {
    const { w } = await wallet();
    await w.grant("u1", grant({ kind: "subscription", credits: 5, expiresAt: T0 + 3_600_000 }));
    vi.setSystemTime(T0 + 2 * 3_600_000);
    expect(await w.reserve("u1", "job1", 1, "job1")).toEqual({ ok: false, balance: 0 });
  });

  it("does not charge twice for a repeated reservation id, and ignores unknown ones", async () => {
    const { w } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    await w.reserve("u1", "job1", 3, "job1");
    expect(await w.reserve("u1", "job1", 3, "job1")).toEqual({ ok: true });
    expect((await w.balance("u1")).total).toBe(7);
    await w.commitReservation("nope", 3, "nope");
    await w.releaseReservation("nope", "nope");
    expect((await w.balance("u1")).total).toBe(7);
  });

  it("never goes negative under 100 concurrent reservations (spec 11.1)", async () => {
    const { h, w } = await wallet();
    await w.grant("u1", grant({ credits: 50 }));
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => w.reserve("u1", `job${i}`, 1, `job${i}`)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(50);
    expect((await w.balance("u1")).total).toBe(0);
    expect(h.db.prepare("SELECT MIN(remaining) AS low FROM credit_buckets").get()).toEqual({
      low: 0,
    });
  });

  it("reports subscription credits apart from permanent ones", async () => {
    const { w } = await wallet();
    await w.grant("u1", grant({ kind: "subscription", credits: 150, expiresAt: T0 + 30 * DAY }));
    await w.grant("u1", grant({ kind: "pack", credits: 60 }));
    expect(await w.balance("u1")).toEqual({
      total: 210,
      subscription: { credits: 150, expiresAt: T0 + 30 * DAY },
      permanent: 60,
    });
  });

  it("forfeits everything when the account is deleted", async () => {
    const { w, types, consistent } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    await w.grant("u1", grant({ kind: "bonus", credits: 5 }));
    await w.forfeitAll("u1", "account_deleted");
    expect((await w.balance("u1")).total).toBe(0);
    expect(types()).toEqual(["grant", "grant", "expire", "expire"]);
    expect(consistent()).toBe(true);
  });
});

// Final review: reservations used to pile up in one DO storage value (128 KiB cap) and live apart
// from the D1 ledger, so a crash between the two could create or lose credits.
describe("Wallet reservations live in D1", () => {
  it("keeps working after more reservations than one storage value can hold", async () => {
    const { w } = await wallet();
    await w.grant("u1", grant({ credits: 1_200 }));
    for (let i = 0; i < 1_200; i++) {
      expect(await w.reserve("u1", `job${i}`, 1, `job${i}`)).toEqual({ ok: true });
      await w.commitReservation(`job${i}`, 1, `job${i}`);
    }
    expect((await w.balance("u1")).total).toBe(0);
  }, 30_000);

  it("records each reservation with its state and time in the same write as the ledger", async () => {
    const { h, w } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    await w.reserve("u1", "job1", 3, "job1");
    const row = () =>
      h.db
        .prepare("SELECT user_id, job_id, state, created_at FROM credit_reservations WHERE id=?")
        .get("job1");
    expect(row()).toEqual({ user_id: "u1", job_id: "job1", state: "held", created_at: T0 });
    await w.commitReservation("job1", 3, "job1");
    expect(row()).toMatchObject({ state: "committed" });
  });

  it("leaves no trace when the D1 write fails, and a retry then succeeds", async () => {
    const { h, w, types } = await wallet();
    await w.grant("u1", grant({ credits: 10 }));
    const db = h.env.DB as D1Database;
    const batch = db.batch.bind(db);
    db.batch = async () => {
      throw new Error("D1 unavailable");
    };
    await expect(w.reserve("u1", "job1", 3, "job1")).rejects.toThrow("D1 unavailable");
    db.batch = batch;
    expect((await w.balance("u1")).total).toBe(10);
    expect(types()).toEqual(["grant"]);
    expect(await w.reserve("u1", "job1", 3, "job1")).toEqual({ ok: true });
    expect((await w.balance("u1")).total).toBe(7);
  });
});
