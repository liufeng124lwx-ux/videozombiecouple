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

/** PRD 8.4 / spec 6.7. Yearly plans still grant credits monthly (spec 6.5). */
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
};

/** Pack credits never expire (spec 5.3). */
export const PACKS: readonly Pack[] = [
  { id: "pack60", credits: 60, usd: 4.99, productKey: "pack60" },
  { id: "pack200", credits: 200, usd: 14.99, productKey: "pack200", badge: "popular" },
  { id: "pack600", credits: 600, usd: 39.99, productKey: "pack600" },
];

export type Product =
  | {
      kind: "plan";
      key: string;
      plan: PlanId;
      interval: Interval;
      monthlyCredits: number;
      usd: number;
    }
  | { kind: "pack"; key: string; credits: number; usd: number };

/** Everything a checkout can sell, keyed like the Waffo products' `productKey` metadata. */
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
    }),
  ),
];

export function productByKey(key: string): Product | null {
  return PRODUCTS.find((product) => product.key === key) ?? null;
}

export const BONUSES = { signup: 5, referral: 20 } as const;

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
