import type { Bindings } from "../types.ts";

export function limiter(env: Bindings, name: string) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
}

/** Sliding-window request limit on one key (spec 7.1). */
export function hitRate(
  env: Bindings,
  name: string,
  limit: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  return limiter(env, name).hit(limit, windowMs);
}
