import type { Interval, PlanId } from "@vzc/catalog";

/** Provider-neutral billing events (spec 6.1); `apply.ts` handles only these. */
export type BillingEvent =
  | {
      kind: "order_paid";
      orderId: string;
      userId: string | null;
      productKey: string;
      amount: number | null;
      currency: string | null;
      clientId: string | null;
      at: number;
    }
  | {
      kind: "sub_started" | "sub_renewed";
      subId: string;
      userId: string | null;
      productKey: string;
      plan: PlanId;
      interval: Interval;
      periodStart: number;
      periodEnd: number;
      amount: number | null;
      currency: string | null;
      clientId: string | null;
      at: number;
    }
  | {
      kind: "sub_plan_changed";
      subId: string;
      productKey: string;
      plan: PlanId;
      interval: Interval;
      at: number;
    }
  | {
      kind: "sub_status";
      subId: string;
      status: "active" | "canceling" | "past_due" | "canceled";
      periodStart: number;
      periodEnd: number;
      at: number;
    }
  | { kind: "refund_succeeded"; orderId: string; amount: number | null; full: boolean; at: number }
  | { kind: "dispute_opened"; orderId: string; at: number }
  | { kind: "dispute_closed"; orderId: string; won: boolean; at: number }
  | { kind: "ignored"; reason: string };
