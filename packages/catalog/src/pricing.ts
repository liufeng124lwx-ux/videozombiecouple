import { PACKS, PLAN_IDS, PLANS, SELL_PLANS } from "./plans.ts";
import { ROUTES, type RouteSeed } from "./routes.ts";
import { CANDIDATES_PER_FRAME, STORYBOARD } from "./story.ts";
import { TIERS } from "./tiers.ts";

/** Every way to buy a credit, with its price. */
export function creditPrices(): { source: string; usdPerCredit: number }[] {
  const prices: { source: string; usdPerCredit: number }[] = [];
  if (SELL_PLANS)
    for (const id of PLAN_IDS) {
      const plan = PLANS[id];
      prices.push({ source: `${id}_month`, usdPerCredit: plan.month.usd / plan.monthlyCredits });
      prices.push({
        source: `${id}_year`,
        usdPerCredit: plan.year.usd / (plan.monthlyCredits * 12),
      });
    }
  for (const pack of PACKS) prices.push({ source: pack.id, usdPerCredit: pack.usd / pack.credits });
  return prices;
}

export function minCreditPrice(): number {
  return Math.min(...creditPrices().map((p) => p.usdPerCredit));
}

/** Revenue must cover at least this multiple of model cost at the cheapest credit (≥ 50% margin). */
export const MARGIN_FACTOR = 2;

const primary = (routes: readonly RouteSeed[], capability: RouteSeed["capability"]) => {
  const rs = routes.filter((r) => r.capability === capability && r.mode === null);
  const rank = Math.min(...rs.map((r) => r.rank));
  return rs.filter((r) => r.rank === rank).reduce((sum, r) => sum + r.costUsd, 0);
};

/** Model cost of one free preview and one paid video on the primary routes. */
export function storyCostUsd(routes: readonly RouteSeed[] = ROUTES): {
  preview: number;
  video: number;
} {
  const keyframe = primary(routes, "keyframe");
  return {
    preview: keyframe * 2 * CANDIDATES_PER_FRAME,
    video: keyframe + primary(routes, "shot") * STORYBOARD.length,
  };
}

export type GuardViolation = { rule: "video_margin"; revenueUsd: number; costUsd: number };

/** A paid video must pay for itself and its preview with margin, at the cheapest credit price. */
export function pricingGuard(
  routes: readonly RouteSeed[] = ROUTES,
  pMin = minCreditPrice(),
): GuardViolation[] {
  const cost = storyCostUsd(routes);
  const revenueUsd = TIERS.video.credits * pMin;
  const costUsd = cost.preview + cost.video;
  return revenueUsd < costUsd * MARGIN_FACTOR
    ? [{ rule: "video_margin", revenueUsd, costUsd }]
    : [];
}
