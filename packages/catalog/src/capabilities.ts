export const CAPABILITY_IDS = ["keyframe", "shot", "describe"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export type Capability = {
  id: CapabilityId;
  /**
   * Dispatcher pool: images and videos have separate concurrency and breakers. "kie-text" is a
   * synchronous chat call (describe): no taskId, never submitted through the task dispatcher.
   */
  pool: "kie-image" | "kie-video" | "kie-text";
  /** Median time to a result on the default route (docs/model-eval.md), for progress estimates. */
  p50Ms: number;
};

export const CAPABILITIES: Record<CapabilityId, Capability> = {
  keyframe: { id: "keyframe", pool: "kie-image", p50Ms: 30_000 },
  shot: { id: "shot", pool: "kie-video", p50Ms: 90_000 },
  describe: { id: "describe", pool: "kie-text", p50Ms: 20_000 },
};

/** Capabilities that run as kie tasks (createTask + poll) through a dispatcher pool. */
export type TaskCapabilityId = Exclude<CapabilityId, "describe">;

export function isTaskCapability(id: CapabilityId): id is TaskCapabilityId {
  return CAPABILITIES[id].pool !== "kie-text";
}

export const TASK_CAPABILITY_IDS: readonly TaskCapabilityId[] =
  CAPABILITY_IDS.filter(isTaskCapability);

/** The dispatcher pool of a task capability; describe never goes through a dispatcher. */
export function taskPool(id: CapabilityId): "kie-image" | "kie-video" {
  const pool = CAPABILITIES[id].pool;
  if (pool === "kie-text") throw new Error(`${id} is not a task capability`);
  return pool;
}
