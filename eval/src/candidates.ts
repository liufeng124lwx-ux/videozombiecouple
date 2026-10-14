// Candidate kie models for keyframes (image edit, multi-reference) and shots (image-to-video with first/last frame).
// Fields and prices from kie schema + pricingDesc fetched 2026-10-14; real spend comes from creditsConsumed.

export type ImageCandidate = {
  key: string;
  model: string;
  estUsd: (refs: number) => number;
  input: (p: { prompt: string; refs: string[] }) => Record<string, unknown>;
};

export const IMAGE_CANDIDATES: ImageCandidate[] = [
  {
    key: "nb2",
    model: "nano-banana-2",
    estUsd: () => 0.025,
    input: ({ prompt, refs }) => ({ prompt, image_input: refs, aspect_ratio: "9:16", resolution: "1K", output_format: "jpg" }),
  },
  {
    key: "nbpro",
    model: "nano-banana-pro",
    estUsd: () => 0.04,
    input: ({ prompt, refs }) => ({ prompt, image_input: refs, aspect_ratio: "9:16", resolution: "1K", output_format: "jpg" }),
  },
  {
    key: "sd5pro",
    model: "seedream/5-pro-image-to-image",
    estUsd: (refs) => 0.035 + Math.max(0, refs - 1) * 0.0025, // first input image free, then $0.0025 each
    input: ({ prompt, refs }) => ({ prompt, image_urls: refs, aspect_ratio: "9:16", quality: "basic", output_format: "jpeg" }),
  },
  {
    key: "gptimg2",
    model: "gpt-image-2-image-to-image",
    estUsd: () => 0.015,
    input: ({ prompt, refs }) => ({ prompt, input_urls: refs, aspect_ratio: "9:16", resolution: "1K" }),
  },
  {
    key: "flux2pro",
    model: "flux-2/pro-image-to-image",
    estUsd: () => 0.025,
    input: ({ prompt, refs }) => ({ prompt, input_urls: refs, aspect_ratio: "9:16", resolution: "1K" }),
  },
];

export type VideoCandidate = {
  key: string;
  model: string;
  minSec: number;
  maxSec: number;
  allowedSec?: number[];
  estUsd: (sec: number) => number;
  input: (p: { prompt: string; first: string; last?: string; sec: number }) => Record<string, unknown>;
};

const seedance = (key: string, model: string, usdPerSec: number): VideoCandidate => ({
  key,
  model,
  minSec: 4,
  maxSec: 15,
  estUsd: (sec) => sec * usdPerSec,
  input: ({ prompt, first, last, sec }) => ({
    prompt,
    first_frame_url: first,
    ...(last ? { last_frame_url: last } : {}),
    resolution: "720p",
    aspect_ratio: "9:16",
    duration: sec,
    generate_audio: false,
  }),
});

export const VIDEO_CANDIDATES: VideoCandidate[] = [
  seedance("sd2mini", "bytedance/seedance-2-mini", 0.041),
  seedance("sd2fast", "bytedance/seedance-2-fast", 0.124),
  {
    key: "kling3std",
    model: "kling-3.0/video",
    minSec: 3,
    maxSec: 15,
    estUsd: (sec) => sec * 0.07,
    // aspect ratio follows the first frame when image_urls is given
    input: ({ prompt, first, last, sec }) => ({ prompt, image_urls: last ? [first, last] : [first], sound: false, duration: String(sec), mode: "std", multi_shots: false }),
  },
  {
    key: "veo31lite",
    model: "veo-3-1",
    minSec: 4,
    maxSec: 8,
    allowedSec: [4, 6, 8],
    estUsd: () => 0.075, // Lite 720p is priced per video
    input: ({ prompt, first, last, sec }) => ({
      prompt,
      model: "veo3_lite",
      generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO",
      image_urls: last ? [first, last] : [first],
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: sec,
    }),
  },
  {
    key: "wan27",
    model: "wan/2-7-image-to-video",
    minSec: 2,
    maxSec: 15,
    estUsd: (sec) => sec * 0.08,
    input: ({ prompt, first, last, sec }) => ({
      prompt,
      negative_prompt: "blood, gore, biting, gunfire, text, extra people, face merging",
      first_frame_url: first,
      ...(last ? { last_frame_url: last } : {}),
      resolution: "720p",
      duration: sec,
      prompt_extend: false,
    }),
  },
];

export function pickSeconds(c: VideoCandidate, targetSec: number): number {
  const want = Math.min(c.maxSec, Math.max(c.minSec, Math.ceil(targetSec)));
  if (!c.allowedSec) return want;
  return c.allowedSec.find((s) => s >= want) ?? c.allowedSec[c.allowedSec.length - 1];
}
