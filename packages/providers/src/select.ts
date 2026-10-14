import { type CapabilityId, type ModeId, ROUTES, TIERS, type TierId } from "@vzc/catalog";
import { intersectAspects } from "@vzc/contracts";
import type { Route } from "./types.ts";

export type RoutePlan = { primary: Route[]; fallbacks: Route[] };

/** The catalog seeds as runtime routes, all enabled. */
export function seedRoutes(): Route[] {
  return ROUTES.map((route) => ({ ...route, enabled: true }));
}

const byRankThenId = (a: Route, b: Route) =>
  a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Spec 4.5: at each rank, routes set for the mode replace the general ones; ranks the mode does not
 * override are inherited, so a mode-specific primary keeps the general fallbacks (spec 4.3). At the
 * lowest enabled rank, routes marked parallel run together; otherwise only the first runs and the
 * rest of that rank lead the fallbacks.
 */
export function planRoutes(
  routes: readonly Route[],
  capability: CapabilityId,
  mode: ModeId,
): RoutePlan {
  const enabled = routes.filter((r) => r.enabled && r.capability === capability);
  const ranks = [...new Set(enabled.map((r) => r.rank))].sort((a, b) => a - b);
  const pool = ranks.flatMap((rank) => {
    const atRank = enabled.filter((r) => r.rank === rank);
    const forMode = atRank.filter((r) => r.mode === mode);
    return (forMode.length > 0 ? forMode : atRank.filter((r) => r.mode === null)).sort(
      byRankThenId,
    );
  });
  const first = pool[0];
  if (!first) throw new Error(`no enabled route for ${capability}`);
  const lowest = pool.filter((r) => r.rank === first.rank);
  const parallel = lowest.filter((r) => r.parallel);
  const primary = parallel.length > 0 ? parallel : [first];
  return { primary, fallbacks: pool.filter((r) => !primary.includes(r)) };
}

/**
 * Spec 3.1: padding is decided per capability over all its routes, enabled or not, so primary,
 * fallback and free retry share one upload and one cropBox even when a breaker flips a route.
 */
export function padAspects(
  routes: readonly Route[],
  capability: CapabilityId,
): { pad: boolean; aspects: string[] } {
  const all = routes.filter((r) => r.capability === capability);
  if (all.length === 0) throw new Error(`no route for ${capability}`);
  return {
    pad: all.every((r) => r.padAspect),
    aspects: intersectAspects(all.map((r) => r.aspects)),
  };
}

/** The tier to charge: the most expensive tier among routes whose result was delivered (spec 3.7). */
export function chargeTier(delivered: readonly Route[]): TierId | null {
  let best: TierId | null = null;
  for (const route of delivered) {
    if (best === null || TIERS[route.creditsTier].credits > TIERS[best].credits)
      best = route.creditsTier;
  }
  return best;
}
