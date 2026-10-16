import { STORIES } from "./stories/index.ts";
import type { StoryId } from "./stories/types.ts";

export const PLAN_IDS = ["starter", "plus", "max"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Interval = "month" | "year";

export type Plan = {
  id: PlanId;
  label: string;
  monthlyCredits: number;
  month: { usd: number; productKey: string };
  year: { usd: number; usdPerMonth: number; productKey: string };
};

/** Kept from UnblurPix for the billing code paths; not sold (SELL_PLANS). */
export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    label: "Starter",
    monthlyCredits: 150,
    month: { usd: 9.9, productKey: "starter_month" },
    year: { usd: 94.8, usdPerMonth: 7.9, productKey: "starter_year" },
  },
  plus: {
    id: "plus",
    label: "Plus",
    monthlyCredits: 450,
    month: { usd: 24.9, productKey: "plus_month" },
    year: { usd: 238.8, usdPerMonth: 19.9, productKey: "plus_year" },
  },
  max: {
    id: "max",
    label: "Max",
    monthlyCredits: 1200,
    month: { usd: 59.9, productKey: "max_month" },
    year: { usd: 574.8, usdPerMonth: 47.9, productKey: "max_year" },
  },
};

export type Pack = {
  id: string;
  credits: number;
  usd: number;
  productKey: string;
  badge?: "popular";
  /** Sold on that story's page only (not in the video pack list). */
  story?: StoryId;
  /** Product name at checkout when "N videos" would be wrong. */
  label?: string;
};

/** Spec §7: one-time video packs (10 credits = 1 video); credits never expire. Prices: owner, 2026-10-15. */
export const PACKS: readonly Pack[] = [
  { id: "pack1", credits: 10, usd: 4.99, productKey: "pack1" },
  { id: "pack3", credits: 30, usd: 13.99, productKey: "pack3", badge: "popular" },
  { id: "pack5", credits: 50, usd: 21.99, productKey: "pack5" },
  // Christmas spec §1.3: one Christmas film, $9.99 (owner, 2026-10-15).
  {
    id: "christmas1",
    credits: 20,
    usd: 9.99,
    productKey: "christmas1",
    story: "christmas",
    label: "1 Christmas film (50 Christmases)",
  },
];

/** The packs on the pricing page's video list and in per-video prices. */
export const VIDEO_PACKS: readonly Pack[] = PACKS.filter((p) => !p.story);

/** Spec §7: no subscriptions. The plan types stay because the billing code still reads them. */
export const SELL_PLANS = false;

export type Product =
  | {
      kind: "plan";
      key: string;
      plan: PlanId;
      interval: Interval;
      monthlyCredits: number;
      usd: number;
    }
  | { kind: "pack"; key: string; credits: number; usd: number; label?: string };

/** Everything a checkout can sell, keyed like the Waffo products' `productKey` metadata. */
/**
 * Every product the billing code knows, keyed like the Waffo products' `productKey` metadata.
 * Plans stay known (old events still parse) but are only sold when SELL_PLANS is on.
 */
export const PRODUCTS: readonly Product[] = [
  ...PLAN_IDS.flatMap((id): Product[] => [
    {
      kind: "plan",
      key: PLANS[id].month.productKey,
      plan: id,
      interval: "month",
      monthlyCredits: PLANS[id].monthlyCredits,
      usd: PLANS[id].month.usd,
    },
    {
      kind: "plan",
      key: PLANS[id].year.productKey,
      plan: id,
      interval: "year",
      monthlyCredits: PLANS[id].monthlyCredits,
      usd: PLANS[id].year.usd,
    },
  ]),
  ...PACKS.map(
    (pack): Product => ({
      kind: "pack",
      key: pack.productKey,
      credits: pack.credits,
      usd: pack.usd,
      ...(pack.label ? { label: pack.label } : {}),
    }),
  ),
];

/** What the pricing page and scripts/waffo-setup.ts offer (spec §7: video packs only). */
export function saleProducts(): readonly Product[] {
  const live = (key: string) => {
    const story = PACKS.find((p) => p.productKey === key)?.story;
    return !story || Object.values(STORIES[story].scenes).some((scene) => scene.live);
  };
  return PRODUCTS.filter((p) => (SELL_PLANS || p.kind === "pack") && live(p.key));
}

/** A story's pack is on sale only once one of its scenes is live; until then it has no price to sell. */
export const SALE_PRODUCTS: readonly Product[] = saleProducts();

export function productByKey(key: string): Product | null {
  return PRODUCTS.find((product) => product.key === key) ?? null;
}

/** No free credits: the free thing is the keyframe preview (spec §7). */
export const BONUSES = { signup: 0, referral: 0 } as const;

export const PHASES = ["P0", "P1", "P2", "P3"] as const;
export type Phase = (typeof PHASES)[number];

export type Perk = {
  id: string;
  phase: Phase;
  plans: readonly PlanId[];
  limits?: Partial<Record<PlanId, number>>;
};

/** The pricing page only shows perks that are live (spec 6.7). */
export const PERKS: readonly Perk[] = [
  { id: "pro_quality", phase: "P0", plans: PLAN_IDS },
  { id: "4k", phase: "P0", plans: PLAN_IDS },
  { id: "priority_queue", phase: "P0", plans: PLAN_IDS },
  { id: "commercial", phase: "P0", plans: PLAN_IDS },
  { id: "batch", phase: "P1", plans: ["plus", "max"], limits: { plus: 20, max: 50 } },
  { id: "history_7d", phase: "P1", plans: PLAN_IDS },
  { id: "api", phase: "P2", plans: ["max"] },
];

export function livePerks(current: Phase): Perk[] {
  const upTo = PHASES.indexOf(current);
  return PERKS.filter((perk) => PHASES.indexOf(perk.phase) <= upTo);
}
