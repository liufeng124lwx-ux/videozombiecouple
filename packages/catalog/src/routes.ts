import type { CapabilityId } from "./capabilities.ts";
import type { ModeId } from "./modes.ts";

export type ProviderId = "kie";

/** Initial provider_routes rows. Synced to D1 on deploy; admin edits win at runtime. */
export type RouteSeed = {
  id: string;
  capability: CapabilityId;
  /** null = applies to both kinds; "pet" rows override at the same rank. */
  mode: ModeId | null;
  /** 1 = primary; higher ranks are tried in order after it fails. */
  rank: number;
  /** Routes sharing the lowest rank with parallel = true are submitted together. */
  parallel: boolean;
  provider: ProviderId;
  model: string;
  /** Fixed string inputs from the kie schema (resolution, quality…); never the prompt or images. */
  params: Record<string, string>;
  timeoutMs: number;
  /** Aspect ratios the model accepts (kie schema API, 2026-10-14). */
  aspects: readonly string[];
  /** Average real cost of one call (docs/model-eval.md); videos at the seconds pickSeconds asks for. */
  costUsd: number;
  label: string;
  /** Video routes: the shortest and longest clip, and the only lengths allowed when listed. */
  minSec?: number;
  maxSec?: number;
  allowedSec?: readonly number[];
};

const PORTRAIT = ["9:16", "3:4", "1:1"] as const;

type Slot = { capability: CapabilityId; rank: number };

const image = (
  s: Slot,
  key: string,
  model: string,
  params: Record<string, string>,
  costUsd: number,
  label: string,
): RouteSeed => ({
  id: `${s.capability}:${key}:${s.rank}`,
  mode: null,
  parallel: false,
  provider: "kie",
  model,
  params,
  timeoutMs: 180_000,
  aspects: PORTRAIT,
  costUsd,
  label,
  ...s,
});

const video = (
  s: Slot,
  key: string,
  model: string,
  params: Record<string, string>,
  costUsd: number,
  label: string,
  sec: { minSec: number; maxSec: number; allowedSec?: readonly number[] },
): RouteSeed => ({
  id: `${s.capability}:${key}:${s.rank}`,
  mode: null,
  parallel: false,
  provider: "kie",
  model,
  params,
  timeoutMs: 600_000,
  aspects: PORTRAIT,
  costUsd,
  label,
  ...sec,
  ...s,
});

/** Synchronous chat routes (describe): no aspect ratio, no seconds, answered within one request. */
const text = (s: Slot, key: string, model: string, costUsd: number, label: string): RouteSeed => ({
  id: `${s.capability}:${key}:${s.rank}`,
  mode: null,
  parallel: false,
  provider: "kie",
  model,
  params: {},
  timeoutMs: 30_000,
  aspects: [],
  costUsd,
  label,
  ...s,
});

/**
 * docs/model-eval.md (eval run r1, 2026-10-14). Timeouts are about twice the measured p90, at least
 * 120 s for images and 300 s for videos; costs are the measured averages.
 */
export const ROUTES: readonly RouteSeed[] = [
  {
    ...image(
      { capability: "keyframe", rank: 1 },
      "gpt-image-2",
      "gpt-image-2-image-to-image",
      { resolution: "1K" },
      0.015,
      "GPT Image 2",
    ),
    timeoutMs: 220_000,
  },
  {
    ...image(
      { capability: "keyframe", rank: 2 },
      "nano-banana-pro",
      "nano-banana-pro",
      { resolution: "1K", output_format: "jpg" },
      0.04,
      "Nano Banana Pro",
    ),
    timeoutMs: 260_000,
  },
  {
    ...image(
      { capability: "keyframe", rank: 3 },
      "seedream-5-pro",
      "seedream/5-pro-image-to-image",
      { quality: "basic", output_format: "jpeg" },
      0.0425,
      "Seedream 5 Pro",
    ),
    timeoutMs: 260_000,
  },
  video(
    { capability: "shot", rank: 1 },
    "kling-3-std",
    "kling-3.0/video",
    { mode: "std" },
    0.21,
    "Kling 3.0",
    { minSec: 3, maxSec: 15 },
  ),
  video(
    { capability: "shot", rank: 2 },
    "veo-3-1-lite",
    "veo-3-1",
    { model: "veo3_lite", resolution: "720p" },
    0.075,
    "Veo 3.1 Lite",
    { minSec: 4, maxSec: 8, allowedSec: [4, 6, 8] },
  ),
  video(
    { capability: "shot", rank: 3 },
    "seedance-2-mini",
    "bytedance/seedance-2-mini",
    { resolution: "720p" },
    0.164,
    "Seedance 2 Mini",
    { minSec: 4, maxSec: 15 },
  ),
  // Describe probe, 2026-10-16: Claude Haiku 5.5 read both photos for 0.06 credits ($0.0003);
  // Gemini 3.6 Flash read them for 0.11 credits ($0.00055). costUsd keeps headroom for longer
  // answers. gemini-3-8-flash-openai answered code 500 that day (24 h success rate 45%); 3.6 has
  // the same OpenAI-style schema and price, ran steadier (84%), and keeps a second vendor.
  text(
    { capability: "describe", rank: 1 },
    "claude-haiku",
    "claude-haiku-5-5",
    0.001,
    "Claude Haiku 5.5",
  ),
  text(
    { capability: "describe", rank: 2 },
    "gemini-flash",
    "gemini-3-6-flash-openai",
    0.001,
    "Gemini 3.6 Flash",
  ),
];
