import { CAPABILITIES, type Capability, type CapabilityId } from "./capabilities.ts";
import { PACKS, PLAN_IDS, PLANS } from "./plans.ts";
import { ROUTES, type RouteSeed } from "./routes.ts";
import { TIERS, type Tier, type TierId } from "./tiers.ts";

/** Every way to buy a credit, with its price. */
export function creditPrices(): { source: string; usdPerCredit: number }[] {
  const prices: { source: string; usdPerCredit: number }[] = [];
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    prices.push({ source: `${id}_month`, usdPerCredit: plan.month.usd / plan.monthlyCredits });
    prices.push({ source: `${id}_year`, usdPerCredit: plan.year.usd / (plan.monthlyCredits * 12) });
  }
  for (const pack of PACKS) prices.push({ source: pack.id, usdPerCredit: pack.usd / pack.credits });
  return prices;
}

export function minCreditPrice(): number {
  return Math.min(...creditPrices().map((p) => p.usdPerCredit));
}

/** Primary results must earn at least 1.5x their cost at the cheapest credit (≥ 33% margin). */
export const PRIMARY_MARGIN_FACTOR = 1.5;

export type GuardInput = {
  capabilities: Record<CapabilityId, Capability>;
  routes: readonly RouteSeed[];
  tiers: Record<TierId, Tier>;
  pMin: number;
};

export type GuardViolation = {
  capability: CapabilityId;
  route?: string;
  rule: "primary_margin" | "route_no_loss";
  revenueUsd: number;
  costUsd: number;
};

export function defaultGuardInput(): GuardInput {
  return { capabilities: CAPABILITIES, routes: ROUTES, tiers: TIERS, pMin: minCreditPrice() };
}

export function pricingGuard(input: GuardInput = defaultGuardInput()): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const capability of Object.values(input.capabilities)) {
    const routes = input.routes.filter((r) => r.capability === capability.id);
    if (routes.length === 0) continue;
    const minRank = Math.min(...routes.map((r) => r.rank));
    // Parallel candidates are all paid for, so the primary cost is their sum.
    const primaryCost = routes
      .filter((r) => r.rank === minRank)
      .reduce((sum, r) => sum + r.costUsd, 0);
    const primaryRevenue = input.tiers[capability.tier].credits * input.pMin;
    if (primaryRevenue < primaryCost * PRIMARY_MARGIN_FACTOR) {
      violations.push({
        capability: capability.id,
        rule: "primary_margin",
        revenueUsd: primaryRevenue,
        costUsd: primaryCost,
      });
    }
    // Any single route's delivered result must not lose money at what that route charges.
    for (const route of routes) {
      const revenue = input.tiers[route.creditsTier].credits * input.pMin;
      if (revenue < route.costUsd) {
        violations.push({
          capability: capability.id,
          route: route.id,
          rule: "route_no_loss",
          revenueUsd: revenue,
          costUsd: route.costUsd,
        });
      }
    }
  }
  return violations;
}
