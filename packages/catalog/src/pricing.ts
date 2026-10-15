import { PACKS, type Pack, PLAN_IDS, PLANS, SELL_PLANS } from "./plans.ts";
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

/** Model cost of one paid film on the primary routes: A/C candidates, B and every shot. */
export function storyCostUsd(routes: readonly RouteSeed[] = ROUTES): { video: number } {
  const keyframe = primary(routes, "keyframe");
  return {
    video: keyframe * (2 * CANDIDATES_PER_FRAME + 1) + primary(routes, "shot") * STORYBOARD.length,
  };
}

/** Waffo, merchant of record: 5% + $0.50 a payment (list rate; 4.5% is a promotion), 1% at payout. */
export const WAFFO_FEE = { rate: 0.05, fixedUsd: 0.5, payoutRate: 0.01 } as const;
/** Share of paid films we expect to be remade once for free (owner's assumption, 2026-10-15). */
export const REMAKE_RATE = 0.3;
/** Evals, example films and staging runs, spread over each paid film (≈ $30 a month at 100 films). */
export const TESTING_PER_FILM_USD = 0.3;

/** What one video of a pack brings in after Waffo's fees. */
export function netPerVideoUsd(pack: Pack): number {
  const net = pack.usd * (1 - WAFFO_FEE.rate) - WAFFO_FEE.fixedUsd;
  return (net * (1 - WAFFO_FEE.payoutRate)) / (pack.credits / TIERS.video.credits);
}

/** The full cost of one paid film: models, the expected free remakes and testing. */
export function filmCostUsd(routes: readonly RouteSeed[] = ROUTES): number {
  return storyCostUsd(routes).video * (1 + REMAKE_RATE) + TESTING_PER_FILM_USD;
}

export type GuardViolation = {
  rule: "video_margin";
  pack: string;
  revenueUsd: number;
  costUsd: number;
};

/** Every pack must net at least MARGIN_FACTOR times the full cost of a film, per video. */
export function pricingGuard(
  routes: readonly RouteSeed[] = ROUTES,
  packs: readonly Pack[] = PACKS,
): GuardViolation[] {
  const costUsd = filmCostUsd(routes);
  return packs.flatMap((pack) => {
    const revenueUsd = netPerVideoUsd(pack);
    return revenueUsd < costUsd * MARGIN_FACTOR
      ? [{ rule: "video_margin" as const, pack: pack.id, revenueUsd, costUsd }]
      : [];
  });
}
