import { PACKS, type Pack, PLAN_IDS, PLANS, SELL_PLANS, VIDEO_PACKS } from "./plans.ts";
import { ROUTES, type RouteSeed } from "./routes.ts";
import { STORIES, type Story, type StoryId, ZOMBIE } from "./stories/index.ts";
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
  for (const pack of VIDEO_PACKS)
    prices.push({ source: pack.id, usdPerCredit: pack.usd / pack.credits });
  return prices;
}

export function minCreditPrice(): number {
  return Math.min(...creditPrices().map((p) => p.usdPerCredit));
}

/** Revenue must cover at least this multiple of model cost at the cheapest credit (≥ 50% margin). */
export const MARGIN_FACTOR = 2;

const primary = (routes: readonly RouteSeed[], capability: RouteSeed["capability"]) => {
  const rs = routes.filter((r) => r.capability === capability && r.mode === null);
  if (rs.length === 0) return 0;
  const rank = Math.min(...rs.map((r) => r.rank));
  return rs.filter((r) => r.rank === rank).reduce((sum, r) => sum + r.costUsd, 0);
};

/** A route's cost is for the seconds pickSeconds asks for: 3 s at least on the default video route. */
const SHOT_BASE_SEC = 3;

/**
 * Model cost of one paid film on the primary routes: every keyframe image, every non-clip shot and,
 * for stories that read the photos first (story.describe), one describe call.
 */
export function storyCostUsd(
  routes: readonly RouteSeed[] = ROUTES,
  story: Story = ZOMBIE,
): { video: number } {
  const keyframe = primary(routes, "keyframe");
  const shot = primary(routes, "shot");
  const images = story.keyframes.reduce((n, k) => n + k.candidates, 0);
  const shotSec = story
    .storyboard("human")
    .filter((s) => !("clip" in s.first))
    .reduce((t, s) => t + Math.max(s.sec, SHOT_BASE_SEC) / SHOT_BASE_SEC, 0);
  const describe = story.describe ? primary(routes, "describe") : 0;
  return { video: keyframe * images + shot * shotSec + describe };
}

/**
 * Stripe Managed Payments (merchant of record): card 2.9% + $0.30, Managed Payments 3.5%,
 * international cards 1.5% more. The worst case is used for the margin check.
 */
export const PAYMENT_FEE = { rate: 0.079, fixedUsd: 0.3 } as const; // 2.9% + 3.5% + 1.5%
/** Share of paid films we expect to be remade once for free (owner's assumption, 2026-10-15). */
export const REMAKE_RATE = 0.3;
/** Evals, example films and staging runs, spread over each paid film (≈ $30 a month at 100 films). */
export const TESTING_PER_FILM_USD = 0.3;

/** What one credit of a pack brings in after the payment fees. */
export function netPerCreditUsd(pack: Pack): number {
  return (pack.usd * (1 - PAYMENT_FEE.rate) - PAYMENT_FEE.fixedUsd) / pack.credits;
}

/** What one zombie video (TIERS.video.credits) of a pack brings in after the fees. */
export function netPerVideoUsd(pack: Pack): number {
  return netPerCreditUsd(pack) * TIERS.video.credits;
}

/** The full cost of one paid film: models, the expected free remakes and testing. */
export function filmCostUsd(routes: readonly RouteSeed[] = ROUTES, story: Story = ZOMBIE): number {
  return storyCostUsd(routes, story).video * (1 + REMAKE_RATE) + TESTING_PER_FILM_USD;
}

export type GuardViolation = {
  rule: "video_margin";
  story: StoryId;
  pack: string;
  revenueUsd: number;
  costUsd: number;
};

/** Every pack that can buy a story must net at least MARGIN_FACTOR times that film's full cost. */
export function pricingGuard(
  routes: readonly RouteSeed[] = ROUTES,
  packs: readonly Pack[] = PACKS,
  stories: readonly Story[] = Object.values(STORIES),
): GuardViolation[] {
  return stories.flatMap((story) => {
    const costUsd = filmCostUsd(routes, story);
    return packs
      .filter((pack) => !pack.story || pack.story === story.id)
      .flatMap((pack) => {
        const revenueUsd = netPerCreditUsd(pack) * story.credits;
        return revenueUsd < costUsd * MARGIN_FACTOR
          ? [{ rule: "video_margin" as const, story: story.id, pack: pack.id, revenueUsd, costUsd }]
          : [];
      });
  });
}
