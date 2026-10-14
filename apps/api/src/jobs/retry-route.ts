import { CAPABILITIES, type CapabilityId, TIERS } from "@vzc/catalog";
import type { Route, RoutePlan } from "@vzc/providers";

/**
 * Spec 3.7: Standard retries on a route the job has not used yet (Nano Banana 2); Pro reruns
 * Nano Banana Pro and 4K reruns Nano Banana Pro 4K with a fresh seed, never a cheaper model.
 */
export function retryRoute(
  capability: CapabilityId,
  plan: RoutePlan,
  usedRouteIds: ReadonlySet<string>,
): Route {
  const strongest = [...plan.primary].sort(
    (a, b) => TIERS[b.creditsTier].credits - TIERS[a.creditsTier].credits,
  )[0] as Route;
  const info = CAPABILITIES[capability];
  if (info.parallelCandidates || info.tier !== "std") return strongest;
  return [...plan.primary, ...plan.fallbacks].find((r) => !usedRouteIds.has(r.id)) ?? strongest;
}
