import type { TierId } from "./tiers.ts";

export const CAPABILITY_IDS = ["unblur.std", "unblur.pro", "unblur.4k"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** Which fidelity checks the browser runs after each result (spec 3.7). */
export type GuardChecks = { composition: boolean; color: boolean; face: boolean };

export type Capability = {
  id: CapabilityId;
  family: "unblur";
  tier: TierId;
  pool: "kie-image";
  /** Standard jobs spend the daily free quota before credits (spec 5.2). */
  usesDailyQuota: boolean;
  /** Run the rank-1 routes side by side and let the user pick (spec 3.7, Pro only). */
  parallelCandidates: boolean;
  /** Median time to the first result, for the "usually ~30s" hint (spec 3.3). */
  p50Ms: number;
  guard: GuardChecks;
};

const ALL_CHECKS: GuardChecks = { composition: true, color: true, face: true };

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  "unblur.std": {
    id: "unblur.std",
    family: "unblur",
    tier: "std",
    pool: "kie-image",
    usesDailyQuota: true,
    parallelCandidates: false,
    p50Ms: 29_000, // eval: seedream-5-flash 2K p50 29s
    guard: ALL_CHECKS,
  },
  "unblur.pro": {
    id: "unblur.pro",
    family: "unblur",
    tier: "pro",
    pool: "kie-image",
    usesDailyQuota: false,
    parallelCandidates: true,
    p50Ms: 29_000, // the Seedream candidate usually lands first
    guard: ALL_CHECKS,
  },
  "unblur.4k": {
    id: "unblur.4k",
    family: "unblur",
    tier: "4k",
    pool: "kie-image",
    usesDailyQuota: false,
    parallelCandidates: false,
    p50Ms: 60_000, // eval measured nano-banana-pro 2K at 60s; recalibrate 4K from health checks
    guard: ALL_CHECKS,
  },
};
