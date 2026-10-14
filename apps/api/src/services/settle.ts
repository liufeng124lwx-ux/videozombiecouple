import { TIERS, type TierId } from "@vzc/catalog";
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

/** Turns the hold into a charge for the delivered tier, or gives it back when nothing was delivered. */
export async function settle(
  env: Bindings,
  jobId: string,
  charge: ChargeHold,
  tier: TierId | null,
): Promise<void> {
  if (charge.kind === "quota") {
    if (tier) await commitQuota(env, charge.counters, charge.nonce);
    else await releaseQuota(env, charge.counters, charge.nonce);
    return;
  }
  if (charge.kind === "credits") {
    const wallet = env.WALLET.get(env.WALLET.idFromName(charge.userId));
    if (tier)
      await wallet.commitReservation(
        charge.reservationId,
        Math.min(TIERS[tier].credits, charge.reserved),
        jobId,
      );
    else await wallet.releaseReservation(charge.reservationId, jobId);
    if (charge.spendCounter) {
      const spend = limiter(env, charge.spendCounter);
      if (tier)
        await spend.commit(charge.reservationId, Math.min(TIERS[tier].credits, charge.reserved));
      else await spend.release(charge.reservationId);
    }
  }
}
