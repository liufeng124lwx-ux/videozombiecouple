import type { CapabilityId } from "./capabilities.ts";
import type { ModeId } from "./modes.ts";
import type { TierId } from "./tiers.ts";

export type ProviderId = "kie";

/** Initial provider_routes rows (spec 4.5). Synced to D1 on deploy; admin edits win at runtime. */
export type RouteSeed = {
  id: string;
  capability: CapabilityId;
  /** null = applies to every mode. */
  mode: ModeId | null;
  /** 1 = primary; higher ranks are tried in order after it fails. */
  rank: number;
  /** Routes sharing the lowest rank with parallel = true are submitted together. */
  parallel: boolean;
  provider: ProviderId;
  model: string;
  params: Record<string, string>;
  timeoutMs: number;
  padAspect: boolean;
  /** What the user is charged when this route's result is the one delivered. */
  creditsTier: TierId;
  /** Aspect ratios the model accepts (verified via the kie schema API, 2026-10-09). */
  aspects: readonly string[];
  costUsd: number;
  /** Shown in the version strip, e.g. "Pro A · Nano Banana Pro". */
  label: string;
};

export const SEEDREAM_ASPECTS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
] as const;
export const NANO_BANANA_PRO_ASPECTS = [...SEEDREAM_ASPECTS, "4:5", "5:4"] as const;
export const NANO_BANANA_2_ASPECTS = [
  ...SEEDREAM_ASPECTS,
  "4:5",
  "5:4",
  "1:4",
  "4:1",
  "1:8",
  "8:1",
] as const;

type Slot = { capability: CapabilityId; rank: number; parallel: boolean; creditsTier: TierId };

const seedream2k = (s: Slot): RouteSeed => ({
  id: `${s.capability}:seedream-2k:${s.rank}`,
  mode: null,
  provider: "kie",
  model: "seedream/5-flash-image-to-image",
  params: { size: "2K", output_format: "png" },
  timeoutMs: 90_000,
  padAspect: true,
  aspects: SEEDREAM_ASPECTS,
  costUsd: 0.0162,
  label: "Seedream",
  ...s,
});

const nanoBananaPro = (s: Slot, resolution: "2K" | "4K", timeoutMs: number): RouteSeed => ({
  id: `${s.capability}:nano-banana-pro-${resolution.toLowerCase()}:${s.rank}`,
  mode: null,
  provider: "kie",
  model: "nano-banana-pro",
  params: { resolution, output_format: "png" },
  timeoutMs,
  padAspect: true,
  aspects: NANO_BANANA_PRO_ASPECTS,
  costUsd: resolution === "4K" ? 0.07 : 0.04,
  label: "Nano Banana Pro",
  ...s,
});

const nanoBanana2 = (s: Slot): RouteSeed => ({
  id: `${s.capability}:nano-banana-2-1k:${s.rank}`,
  mode: null,
  provider: "kie",
  model: "nano-banana-2",
  params: { resolution: "1K", output_format: "png" },
  timeoutMs: 120_000,
  padAspect: true,
  aspects: NANO_BANANA_2_ASPECTS,
  costUsd: 0.025,
  label: "Nano Banana 2",
  ...s,
});

/** From docs/model-eval.md §3 and spec 4.5. */
export const ROUTES: readonly RouteSeed[] = [
  seedream2k({ capability: "unblur.std", rank: 1, parallel: false, creditsTier: "std" }),
  nanoBanana2({ capability: "unblur.std", rank: 2, parallel: false, creditsTier: "std" }),

  nanoBananaPro(
    { capability: "unblur.pro", rank: 1, parallel: true, creditsTier: "pro" },
    "2K",
    180_000,
  ),
  seedream2k({ capability: "unblur.pro", rank: 1, parallel: true, creditsTier: "std" }),
  nanoBanana2({ capability: "unblur.pro", rank: 3, parallel: false, creditsTier: "std" }),

  nanoBananaPro(
    { capability: "unblur.4k", rank: 1, parallel: false, creditsTier: "4k" },
    "4K",
    120_000,
  ),
  seedream2k({ capability: "unblur.4k", rank: 2, parallel: false, creditsTier: "std" }),
];
