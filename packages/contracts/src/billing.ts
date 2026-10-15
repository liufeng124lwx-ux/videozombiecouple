import { z } from "zod";

/**
 * What the buyer ticks before paying (EU/UK consumer law): make the films right away, and lose the
 * 14-day right of withdrawal for each film once it starts. Bump it when that text changes; Stripe
 * keeps the version on the session as evidence.
 */
export const WITHDRAWAL_WAIVER_VERSION = "2026-10-15";

export const CheckoutSchema = z.object({
  productKey: z.string().min(1).max(40),
  /** WITHDRAWAL_WAIVER_VERSION; anything else is answered CONSENT_REQUIRED. */
  waiver: z.string().max(32).optional(),
  /** Same-site path to come back to after paying (spec 6.4). */
  returnPath: z.string().max(200).optional(),
  /** GA4 client_id, so the server-side purchase event joins the browser session (spec 9). */
  clientId: z
    .string()
    .max(64)
    .regex(/^[\w.-]+$/)
    .optional(),
});

export const ChangePlanSchema = z.object({ productKey: z.string().min(1).max(40) });

export type BillingView = {
  subscription: {
    plan: "starter" | "plus" | "max";
    interval: "month" | "year";
    status: "active" | "canceling" | "past_due" | "canceled";
    periodEnd: number;
    cancelAt: number | null;
  } | null;
  /** A chargeback is open: paid features are paused until it ends (spec 6.6). */
  paidPaused: boolean;
  /** Credits a refund could not take back. */
  refundDebt: number;
};
