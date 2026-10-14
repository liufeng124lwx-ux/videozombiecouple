import type { RouteSeed } from "@vzc/catalog";

const VIDEO = /seedance|kling|veo|wan\//;

export function route(model: string, over: Partial<RouteSeed> = {}): RouteSeed {
  return {
    id: `t:${model}`,
    capability: VIDEO.test(model) ? "shot" : "keyframe",
    mode: null,
    rank: 1,
    parallel: false,
    provider: "kie",
    model,
    params: {},
    timeoutMs: 60_000,
    aspects: ["9:16"],
    costUsd: 0.1,
    label: model,
    ...over,
  };
}
