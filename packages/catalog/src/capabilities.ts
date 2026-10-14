export const CAPABILITY_IDS = ["keyframe", "shot"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type Capability = {
  id: CapabilityId;
  /** Dispatcher pool: images and videos have separate concurrency and breakers. */
  pool: "kie-image" | "kie-video";
  /** Median time to a result on the default route (docs/model-eval.md), for progress estimates. */
  p50Ms: number;
};

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  keyframe: { id: "keyframe", pool: "kie-image", p50Ms: 30_000 },
  shot: { id: "shot", pool: "kie-video", p50Ms: 90_000 },
};
