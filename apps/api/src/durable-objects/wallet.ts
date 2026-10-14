import { DurableObject } from "cloudflare:workers";
import type { BalanceView } from "@vzc/contracts";
import { ulid } from "../services/ids.ts";
import type { WalletApi } from "../services/settle.ts";
import type { Bindings } from "../types.ts";

export type BucketKind = "subscription" | "pack" | "bonus" | "admin";
export type CreditGrant = {
  kind: BucketKind;
  credits: number;
  /** null: never expires (packs, sign-up bonus). */
  expiresAt: number | null;
  /** Order id, "signup", …: a second grant with the same source is ignored. */
  sourceRef: string | null;
  /** Billing order that paid for these credits; recorded on the ledger (spec 5.3). */
  orderId?: string;
  reason: string;
};

type Part = { bucketId: string; credits: number };
type ReservationRow = { user_id: string; job_id: string; parts: string; state: string };
type BucketRow = { id: string; kind: BucketKind; remaining: number; expires_at: number | null };
type LedgerType =
  | "grant"
  | "reserve"
  | "commit"
  | "release"
  | "expire"
  | "clawback"
  | "admin_adjust";

/** Spec 5.3: a refund whose bucket has expired goes to a new bonus bucket valid this long. */
export const REFUND_BONUS_MS = 30 * 86_400_000;

/**
 * One object per user (spec 5.3). D1 holds the buckets, the append-only ledger and the reservations;
 * this object serialises every change for its user and writes each change as one D1 batch, so a
 * bucket's `remaining` always equals the sum of its ledger rows and a reservation's state always
 * matches them.
 */
export class Wallet extends DurableObject<Bindings> implements WalletApi {
  #queue: Promise<unknown> = Promise.resolve();

  /** Input gates do not cover D1 awaits; this keeps a user's changes strictly one at a time. */
  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #ledger(
    userId: string,
    bucketId: string,
    delta: number,
    type: LedgerType,
    refs: { jobId?: string; orderId?: string; reason?: string } = {},
  ): D1PreparedStatement {
    return this.env.DB.prepare(
      "INSERT INTO credit_ledger(user_id,bucket_id,delta,type,job_id,order_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      userId,
      bucketId,
      delta,
      type,
      refs.jobId ?? null,
      refs.orderId ?? null,
      refs.reason ?? null,
      Date.now(),
    );
  }

  /** Unexpired buckets with credits, in spending order: subscription first, then oldest first. */
  async #spendable(userId: string): Promise<BucketRow[]> {
    const { results } = await this.env.DB.prepare(
      "SELECT id, kind, remaining, expires_at FROM credit_buckets WHERE user_id=? AND remaining>0 AND (expires_at IS NULL OR expires_at>?) ORDER BY CASE kind WHEN 'subscription' THEN 0 ELSE 1 END, created_at, id",
    )
      .bind(userId, Date.now())
      .all<BucketRow>();
    return results;
  }

  #insertGrant(
    userId: string,
    bucketId: string,
    kind: BucketKind,
    grant: Omit<CreditGrant, "kind">,
  ) {
    return [
      this.env.DB.prepare(
        "INSERT INTO credit_buckets(id,user_id,kind,granted,remaining,expires_at,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        bucketId,
        userId,
        kind,
        grant.credits,
        grant.credits,
        grant.expiresAt,
        grant.sourceRef,
        Date.now(),
      ),
      // Spec 5.3: an admin's change is its own ledger type, so nobody mistakes it for a purchase.
      this.#ledger(userId, bucketId, grant.credits, kind === "admin" ? "admin_adjust" : "grant", {
        reason: grant.reason,
        ...(grant.orderId ? { orderId: grant.orderId } : {}),
      }),
    ];
  }

  async #existing(userId: string, sourceRef: string | null): Promise<string | null> {
    if (sourceRef === null) return null;
    const row = await this.env.DB.prepare(
      "SELECT id FROM credit_buckets WHERE user_id=? AND source_ref=?",
    )
      .bind(userId, sourceRef)
      .first<{ id: string }>();
    return row?.id ?? null;
  }

  grant(userId: string, grant: CreditGrant): Promise<{ bucketId: string; created: boolean }> {
    return this.#serial(async () => {
      const existing = await this.#existing(userId, grant.sourceRef);
      if (existing) return { bucketId: existing, created: false };
      const bucketId = ulid();
      await this.env.DB.batch(this.#insertGrant(userId, bucketId, grant.kind, grant));
      return { bucketId, created: true };
    });
  }

  /**
   * Spec 6.5: a new subscription period voids what is left of earlier subscription credits and
   * grants the new ones, in one batch. Repeating the same `sourceRef` does nothing.
   */
  renewSubscription(
    userId: string,
    grant: Omit<CreditGrant, "kind">,
  ): Promise<{ bucketId: string; created: boolean }> {
    return this.#serial(async () => {
      const existing = await this.#existing(userId, grant.sourceRef);
      if (existing) return { bucketId: existing, created: false };
      const { results: old } = await this.env.DB.prepare(
        "SELECT id, remaining FROM credit_buckets WHERE user_id=? AND kind='subscription' AND remaining>0",
      )
        .bind(userId)
        .all<{ id: string; remaining: number }>();
      const bucketId = ulid();
      await this.env.DB.batch([
        ...old.flatMap((bucket) => [
          this.env.DB.prepare("UPDATE credit_buckets SET remaining = 0 WHERE id=?").bind(bucket.id),
          this.#ledger(userId, bucket.id, -bucket.remaining, "expire", {
            reason: "subscription_renewed",
          }),
        ]),
        ...this.#insertGrant(userId, bucketId, "subscription", grant),
      ]);
      return { bucketId, created: true };
    });
  }

  reserve(
    userId: string,
    reservationId: string,
    credits: number,
    jobId: string,
  ): Promise<{ ok: true } | { ok: false; balance: number }> {
    return this.#serial(async () => {
      if (await this.#reservation(reservationId)) return { ok: true };
      const buckets = await this.#spendable(userId);
      const balance = buckets.reduce((sum, bucket) => sum + bucket.remaining, 0);
      if (balance < credits) return { ok: false, balance };
      const parts: Part[] = [];
      let left = credits;
      for (const bucket of buckets) {
        if (left === 0) break;
        const take = Math.min(left, bucket.remaining);
        parts.push({ bucketId: bucket.id, credits: take });
        left -= take;
      }
      const now = Date.now();
      // One batch: the hold, the deductions and their ledger rows land together or not at all.
      // `remaining >= 0` is a CHECK, so a deduction that would overdraw fails the whole batch.
      await this.env.DB.batch([
        this.env.DB.prepare(
          "INSERT INTO credit_reservations(id,user_id,job_id,parts,state,created_at,updated_at) VALUES(?,?,?,?,'held',?,?)",
        ).bind(reservationId, userId, jobId, JSON.stringify(parts), now, now),
        ...parts.flatMap((part) => [
          this.env.DB.prepare(
            "UPDATE credit_buckets SET remaining = remaining - ? WHERE id=?",
          ).bind(part.credits, part.bucketId),
          this.#ledger(userId, part.bucketId, -part.credits, "reserve", { jobId }),
        ]),
      ]);
      return { ok: true };
    });
  }

  async #reservation(id: string): Promise<ReservationRow | null> {
    return this.env.DB.prepare(
      "SELECT user_id, job_id, parts, state FROM credit_reservations WHERE id=?",
    )
      .bind(id)
      .first<ReservationRow>();
  }

  /** Statements that put `parts` back; a part whose bucket expired becomes a new 30-day bonus. */
  async #giveBack(userId: string, parts: Part[], jobId: string): Promise<D1PreparedStatement[]> {
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    for (const part of parts) {
      const bucket = await this.env.DB.prepare("SELECT expires_at FROM credit_buckets WHERE id=?")
        .bind(part.bucketId)
        .first<{ expires_at: number | null }>();
      if (bucket && (bucket.expires_at === null || bucket.expires_at > now)) {
        statements.push(
          this.env.DB.prepare(
            "UPDATE credit_buckets SET remaining = remaining + ? WHERE id=?",
          ).bind(part.credits, part.bucketId),
          this.#ledger(userId, part.bucketId, part.credits, "release", { jobId }),
        );
      } else {
        const bucketId = ulid();
        statements.push(
          this.env.DB.prepare(
            "INSERT INTO credit_buckets(id,user_id,kind,granted,remaining,expires_at,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?)",
          ).bind(
            bucketId,
            userId,
            "bonus",
            part.credits,
            part.credits,
            now + REFUND_BONUS_MS,
            null,
            now,
          ),
          this.#ledger(userId, bucketId, part.credits, "release", {
            jobId,
            reason: "refund_after_expiry",
          }),
        );
      }
    }
    return statements;
  }

  /** Spec 4.3: charging fewer credits than reserved (a downgrade) gives the rest back. */
  commitReservation(reservationId: string, credits: number, jobId: string): Promise<void> {
    return this.#serial(async () => {
      const reservation = await this.#reservation(reservationId);
      if (!reservation || reservation.state !== "held") return;
      const parts = JSON.parse(reservation.parts) as Part[];
      const reserved = parts.reduce((sum, part) => sum + part.credits, 0);
      let refund = Math.max(0, reserved - Math.max(0, credits));
      // Give back from the last parts first, so subscription credits are the ones charged.
      const back: Part[] = [];
      for (const part of [...parts].reverse()) {
        if (refund === 0) break;
        const amount = Math.min(refund, part.credits);
        back.push({ bucketId: part.bucketId, credits: amount });
        refund -= amount;
      }
      await this.env.DB.batch([
        this.#settleRow(reservationId, "committed"),
        ...parts.map((part) =>
          this.#ledger(reservation.user_id, part.bucketId, 0, "commit", { jobId }),
        ),
        ...(await this.#giveBack(reservation.user_id, back, jobId)),
      ]);
    });
  }

  releaseReservation(reservationId: string, jobId: string): Promise<void> {
    return this.#serial(async () => {
      const reservation = await this.#reservation(reservationId);
      if (!reservation || reservation.state !== "held") return;
      const parts = JSON.parse(reservation.parts) as Part[];
      await this.env.DB.batch([
        this.#settleRow(reservationId, "released"),
        ...(await this.#giveBack(reservation.user_id, parts, jobId)),
      ]);
    });
  }

  #settleRow(reservationId: string, state: "committed" | "released"): D1PreparedStatement {
    return this.env.DB.prepare(
      "UPDATE credit_reservations SET state=?, updated_at=? WHERE id=? AND state='held'",
    ).bind(state, Date.now(), reservationId);
  }

  async balance(userId: string): Promise<BalanceView> {
    const buckets = await this.#spendable(userId);
    const subscription = buckets.filter((bucket) => bucket.kind === "subscription");
    const subscriptionCredits = subscription.reduce((sum, bucket) => sum + bucket.remaining, 0);
    const total = buckets.reduce((sum, bucket) => sum + bucket.remaining, 0);
    return {
      total,
      subscription:
        subscription.length > 0
          ? {
              credits: subscriptionCredits,
              expiresAt: Math.min(...subscription.map((bucket) => bucket.expires_at ?? 0)),
            }
          : null,
      permanent: total - subscriptionCredits,
    };
  }

  /**
   * Spec 6.6: take back `credits` for a refund or chargeback — first from the order's own unexpired
   * buckets (newest first), then from other credits in spending order, never below zero.
   * `debt` is what could not be taken back.
   */
  clawback(
    userId: string,
    claim: {
      credits: number;
      sourcePrefix: string;
      orderId: string;
      reason: string;
      /** An admin taking credits away (spec 8.1) rather than a refund or chargeback. */
      type?: "clawback" | "admin_adjust";
    },
  ): Promise<{ clawed: number; debt: number }> {
    return this.#serial(async () => {
      const now = Date.now();
      const { results: own } = await this.env.DB.prepare(
        "SELECT id, kind, remaining, expires_at FROM credit_buckets WHERE user_id=? AND remaining>0 AND substr(source_ref, 1, ?) = ? AND (expires_at IS NULL OR expires_at>?) ORDER BY created_at DESC, id DESC",
      )
        .bind(userId, claim.sourcePrefix.length, claim.sourcePrefix, now)
        .all<BucketRow>();
      const others = (await this.#spendable(userId)).filter(
        (bucket) => !own.some((mine) => mine.id === bucket.id),
      );
      const parts: Part[] = [];
      let left = claim.credits;
      for (const bucket of [...own, ...others]) {
        if (left === 0) break;
        const take = Math.min(left, bucket.remaining);
        parts.push({ bucketId: bucket.id, credits: take });
        left -= take;
      }
      if (parts.length > 0)
        await this.env.DB.batch(
          parts.flatMap((part) => [
            this.env.DB.prepare(
              "UPDATE credit_buckets SET remaining = remaining - ? WHERE id=?",
            ).bind(part.credits, part.bucketId),
            this.#ledger(userId, part.bucketId, -part.credits, claim.type ?? "clawback", {
              orderId: claim.orderId,
              reason: claim.reason,
            }),
          ]),
        );
      return { clawed: claim.credits - left, debt: left };
    });
  }

  /** Spec 5.5: deleting the account forfeits every remaining credit. */
  forfeitAll(userId: string, reason: string): Promise<void> {
    return this.#serial(async () => {
      const { results } = await this.env.DB.prepare(
        "SELECT id, kind, remaining, expires_at FROM credit_buckets WHERE user_id=? AND remaining>0 ORDER BY created_at, id",
      )
        .bind(userId)
        .all<BucketRow>();
      if (results.length === 0) return;
      await this.env.DB.batch(
        results.flatMap((bucket) => [
          this.env.DB.prepare("UPDATE credit_buckets SET remaining = 0 WHERE id=?").bind(bucket.id),
          this.#ledger(userId, bucket.id, -bucket.remaining, "expire", { reason }),
        ]),
      );
    });
  }
}
