import {
  CANDIDATES_PER_FRAME,
  type FrameId,
  keyframePrompt,
  STORYBOARD,
  shotPrompt,
} from "@vzc/catalog";
import type { Phase, StepRecord, StoryState } from "./types.ts";

const step = (
  id: string,
  kind: StepRecord["kind"],
  phase: Phase,
  deps: string[],
  capability?: StepRecord["capability"],
): StepRecord => ({
  id,
  kind,
  phase,
  ...(capability ? { capability } : {}),
  deps,
  state: "waiting",
  attempts: [],
  fallbacks: [],
  outputKey: null,
  failures: 0,
  nextRunAt: null,
  error: null,
  failKind: null,
});

/**
 * Spec §4.2 S0b–S2: check the two photos (one face each, adults) before any model sees them, then
 * two candidates each for keyframes A and C, then one scoring call to pick the best of each.
 */
export function previewSteps(): StepRecord[] {
  const sources = step("score:sources", "score", "preview", []);
  const kf = (["A", "C"] as const).flatMap((frame) =>
    Array.from({ length: CANDIDATES_PER_FRAME }, (_, i) =>
      step(`kf:${frame}:${i + 1}`, "kie", "preview", [sources.id], "keyframe"),
    ),
  );
  return [
    sources,
    ...kf,
    step(
      "score:AC",
      "score",
      "preview",
      kf.map((s) => s.id),
    ),
  ];
}

/** Spec §4.2 S3–S5: keyframe B, the shots (shot 3 ends on B, shot 5 starts from it), then compose. */
export function videoSteps(): StepRecord[] {
  const shots = STORYBOARD.map((shot) =>
    step(
      `shot:${shot.id}`,
      "kie",
      "video",
      shot.first === "B" || shot.last === "B" ? ["kf:B"] : [],
      "shot",
    ),
  );
  return [
    step("kf:B", "kie", "video", [], "keyframe"),
    ...shots,
    step(
      "compose",
      "compose",
      "video",
      shots.map((s) => s.id),
    ),
  ];
}

const ended = (s: StepRecord) => s.state === "succeeded" || s.state === "failed";
const candidates = (state: StoryState, frame: "A" | "C") =>
  Object.values(state.steps).filter((s) => s.id.startsWith(`kf:${frame}:`));

export function activePhase(state: StoryState): Phase | null {
  if (state.status === "previewing") return "preview";
  if (state.status === "rendering") return "video";
  return null;
}

/** Steps of the running phase that can start now. */
export function readySteps(state: StoryState): StepRecord[] {
  const phase = activePhase(state);
  if (!phase) return [];
  return Object.values(state.steps).filter((s) => {
    if (s.phase !== phase || s.state !== "waiting") return false;
    const deps = s.deps.map((id) => state.steps[id]).filter((d): d is StepRecord => !!d);
    if (s.id === "score:AC")
      return (
        deps.every(ended) &&
        (["A", "C"] as const).every((f) =>
          candidates(state, f).some((d) => d.state === "succeeded"),
        )
      );
    return deps.every((d) => d.state === "succeeded");
  });
}

export function phaseOutcome(state: StoryState, phase: Phase): "running" | "succeeded" | "failed" {
  if (phase === "preview") {
    if (state.steps["score:sources"]?.state === "failed") return "failed";
    for (const frame of ["A", "C"] as const)
      if (candidates(state, frame).every((s) => s.state === "failed")) return "failed";
    const score = state.steps["score:AC"];
    if (score?.state === "succeeded") return "succeeded";
    return score?.state === "failed" ? "failed" : "running";
  }
  const steps = Object.values(state.steps).filter((s) => s.phase === "video");
  if (steps.some((s) => s.state === "failed")) return "failed";
  return state.steps.compose?.state === "succeeded" ? "succeeded" : "running";
}

export function outputKeyFor(storyId: string, stepId: string, ext: "jpg" | "mp4"): string {
  const prefix = ext === "mp4" ? "shot" : "kf";
  return `${prefix}/${storyId}/${stepId.replaceAll(":", "-")}.${ext}`;
}

export type KieStepInput = {
  prompt: string;
  images: string[];
  first?: string;
  last?: string;
  targetSec?: number;
};

/** The prompt and signed input URLs for one kie step (spec §4.2, §5). */
export async function kieInputFor(
  step: StepRecord,
  state: StoryState,
  url: (key: string) => Promise<string>,
): Promise<KieStepInput> {
  const { spec, picks } = state;
  const photos = [await url(spec.survivorKey), await url(spec.infectedKey)];
  if (step.id.startsWith("kf:")) {
    const frame = step.id.split(":")[1] as FrameId;
    const prompt = keyframePrompt(spec.scene, frame, spec.kind);
    if (frame !== "B") return { prompt, images: photos };
    const a = picks.A;
    const c = picks.C;
    if (!a || !c) throw new Error("keyframe B needs the picked A and C");
    return { prompt, images: [...photos, await url(a), await url(c)] };
  }
  const shot = STORYBOARD.find((s) => `shot:${s.id}` === step.id);
  if (!shot) throw new Error(`no kie input for step ${step.id}`);
  const frameKey = (frame: FrameId) => {
    const key = frame === "B" ? state.steps["kf:B"]?.outputKey : picks[frame];
    if (!key) throw new Error(`shot ${shot.id} needs keyframe ${frame}`);
    return url(key);
  };
  return {
    prompt: shotPrompt(spec.scene, shot.id, spec.kind),
    images: [],
    first: await frameKey(shot.first),
    ...(shot.last ? { last: await frameKey(shot.last) } : {}),
    targetSec: shot.targetSec,
  };
}
