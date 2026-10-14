import { type CapabilityId, type ModeId, ROUTES, type RouteSeed } from "@vzc/catalog";
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

/** Clip length to ask a video route for: the target rounded up into the route's limits (spec §5.1). */
export function pickSeconds(route: RouteSeed, targetSec: number): number {
  const want = Math.min(route.maxSec ?? 15, Math.max(route.minSec ?? 1, Math.ceil(targetSec)));
  const allowed = route.allowedSec;
  if (!allowed?.length) return want;
  return allowed.find((s) => s >= want) ?? (allowed[allowed.length - 1] as number);
}
