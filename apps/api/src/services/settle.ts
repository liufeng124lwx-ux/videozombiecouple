import type { Bindings } from "../types.ts";
import { limiter } from "./limits.ts";
import { commitQuota, releaseQuota } from "./quota.ts";

/**
 * Implemented by the Wallet DO (durable-objects/wallet.ts). Both calls must be idempotent per reservation: a JobRunner
 * whose alarm failed mid-settlement calls again. Committing fewer credits than were reserved
 * gives the rest back (spec 4.3: a downgrade charges the delivered tier).
 */
export interface WalletApi {
  commitReservation(reservationId: string, credits: number, jobId: string): Promise<void>;
  releaseReservation(reservationId: string, jobId: string): Promise<void>;
}

/** What was held when the job was created (spec 5.2, 5.3). */
export type ChargeHold =
  | { kind: "quota"; nonce: string; counters: string[] }
  | {
      kind: "credits";
      userId: string;
      reservationId: string;
      reserved: number;
      spendCounter?: string;
    }
  | { kind: "none" };

/** Turns the hold into a charge of `credits` (commit), or gives it back (null). */
export async function settle(
  env: Bindings,
  storyId: string,
  charge: ChargeHold,
  credits: number | null,
): Promise<void> {
  if (charge.kind === "quota") {
    if (credits !== null) await commitQuota(env, charge.counters, charge.nonce);
    else await releaseQuota(env, charge.counters, charge.nonce);
    return;
  }
  if (charge.kind === "credits") {
    const wallet = env.WALLET.get(env.WALLET.idFromName(charge.userId));
    const spent = credits === null ? null : Math.min(credits, charge.reserved);
    if (spent !== null) await wallet.commitReservation(charge.reservationId, spent, storyId);
    else await wallet.releaseReservation(charge.reservationId, storyId);
    if (charge.spendCounter) {
      const spend = limiter(env, charge.spendCounter);
      if (spent !== null) await spend.commit(charge.reservationId, spent);
      else await spend.release(charge.reservationId);
    }
  }
}
