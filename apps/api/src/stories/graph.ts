import {
  type FrameRef,
  type Kind,
  portraitPrompt,
  type Story,
  type StoryKeyframe,
  storyOf,
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

/** Before payment: only the check of the two photos (one face each, adults), on our own container. */
export function previewSteps(): StepRecord[] {
  return [step("score:sources", "score", "preview", [])];
}

/**
 * The free AI zombie filter (SEO review 2026-10-15): check the one photo, make one zombie portrait
 * on the free pool, stamp it with the AI mark. All of it in the preview phase, so the free budget
 * counts it; nothing is charged.
 */
export function photoSteps(): StepRecord[] {
  return [
    step("score:sources", "score", "preview", []),
    step("kf:Z", "kie", "preview", ["score:sources"], "keyframe"),
    step("mark", "mark", "preview", ["kf:Z"]),
  ];
}

export const isPhoto = (state: StoryState) => state.spec.product === "photo";

const scored = (story: Story) => story.keyframes.filter((k) => k.candidates >= 2);

/** The one scoring step of a film: zombie "score:AC" (kept for films already running). */
export function scoreStepId(story: Story): string | null {
  const ids = scored(story).map((k) => k.id);
  return ids.length ? `score:${ids.join("")}` : null;
}

function keyframe(story: Story, id: string): StoryKeyframe {
  const k = story.keyframes.find((x) => x.id === id);
  if (!k) throw new Error(`${story.id} has no keyframe ${id}`);
  return k;
}

/** The step that makes a frame usable: the scoring step for scored frames, else the frame's own. */
function frameStep(story: Story, id: string): string {
  return keyframe(story, id).candidates >= 2 ? (scoreStepId(story) as string) : `kf:${id}`;
}

/** Drops deps another dep already waits for (shot 3 waits for B, and B for the scoring). */
function reduce(ids: string[], all: Map<string, string[]>): string[] {
  const unique = [...new Set(ids)];
  const reaches = (from: string, to: string): boolean =>
    (all.get(from) ?? []).some((d) => d === to || reaches(d, to));
  return unique.filter((d) => !unique.some((o) => o !== d && reaches(o, d)));
}

/**
 * After payment (owner, 2026-10-15: nothing is generated for free): the candidates of the scored
 * keyframes, one scoring call, the other keyframes in the order their refs allow, every shot that
 * is not a scene clip, then compose.
 */
export function videoSteps(story: Story, kind: Kind): StepRecord[] {
  const graph = new Map<string, string[]>();
  const add = (s: StepRecord) => {
    s.deps = reduce(s.deps, graph);
    graph.set(s.id, s.deps);
    return s;
  };
  const refDeps = (refs: readonly FrameRef[]) =>
    refs.flatMap((r) => ("frame" in r ? [frameStep(story, r.frame)] : []));
  const candidates = scored(story).flatMap((k) =>
    Array.from({ length: k.candidates }, (_, i) =>
      add(step(`kf:${k.id}:${i + 1}`, "kie", "video", refDeps(k.refs), "keyframe")),
    ),
  );
  const scoreId = scoreStepId(story);
  const score = scoreId
    ? [
        add(
          step(
            scoreId,
            "score",
            "video",
            candidates.map((s) => s.id),
          ),
        ),
      ]
    : [];
  const singles = story.keyframes
    .filter((k) => k.candidates < 2)
    .map((k) => add(step(`kf:${k.id}`, "kie", "video", refDeps(k.refs), "keyframe")));
  const shots = story
    .storyboard(kind)
    .filter((s) => !("clip" in s.first))
    .map((s) =>
      add(
        step(
          `shot:${s.id}`,
          "kie",
          "video",
          [
            ...("frame" in s.first ? [frameStep(story, s.first.frame)] : []),
            ...(s.last ? [frameStep(story, s.last.frame)] : []),
          ],
          "shot",
        ),
      ),
    );
  const compose = add(
    step(
      "compose",
      "compose",
      "video",
      shots.map((s) => s.id),
    ),
  );
  return [...candidates, ...score, ...singles, ...shots, compose];
}

const ended = (s: StepRecord) => s.state === "succeeded" || s.state === "failed";
const isCandidate = (id: string) => /^kf:[^:]+:\d+$/.test(id);
const frameOf = (id: string) => id.split(":")[1] as string;

/** Candidate steps of this film, by frame. */
function candidateGroups(state: StoryState): Map<string, StepRecord[]> {
  const groups = new Map<string, StepRecord[]>();
  for (const s of Object.values(state.steps))
    if (s.phase === "video" && isCandidate(s.id))
      groups.set(frameOf(s.id), [...(groups.get(frameOf(s.id)) ?? []), s]);
  return groups;
}

/** The R2 key a frame resolves to: the picked candidate, else the frame's own output. */
export function frameKey(state: StoryState, frame: string): string | null {
  return state.picks[frame] ?? state.steps[`kf:${frame}`]?.outputKey ?? null;
}

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
    if (s.kind === "score" && s.phase === "video")
      return (
        deps.every(ended) &&
        [...candidateGroups(state).values()].every((g) => g.some((d) => d.state === "succeeded"))
      );
    return deps.every((d) => d.state === "succeeded");
  });
}

export function phaseOutcome(state: StoryState, phase: Phase): "running" | "succeeded" | "failed" {
  if (phase === "preview" && isPhoto(state)) {
    const steps = Object.values(state.steps).filter((s) => s.phase === "preview");
    if (steps.some((s) => s.state === "failed")) return "failed";
    return state.steps.mark?.state === "succeeded" ? "succeeded" : "running";
  }
  if (phase === "preview") {
    const check = state.steps["score:sources"];
    if (check?.state === "failed") return "failed";
    return check?.state === "succeeded" ? "succeeded" : "running";
  }
  // A failed candidate is fine while another of the same frame can still win.
  for (const group of candidateGroups(state).values())
    if (group.every((s) => s.state === "failed")) return "failed";
  const steps = Object.values(state.steps).filter((s) => s.phase === "video" && !isCandidate(s.id));
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

/** The prompt and signed input URLs for one kie step (spec §4.2, §5; christmas spec §3). */
export async function kieInputFor(
  step: StepRecord,
  state: StoryState,
  url: (key: string) => Promise<string>,
): Promise<KieStepInput> {
  const { spec } = state;
  if (step.id === "kf:Z")
    return { prompt: portraitPrompt(), images: [await url(spec.survivorKey)] };
  const story = storyOf(spec);
  const scene = story.scenes[spec.scene];
  if (!scene) throw new Error(`${story.id} has no scene ${spec.scene}`);
  const need = (frame: string) => {
    const key = frameKey(state, frame);
    if (!key) throw new Error(`${step.id} needs keyframe ${frame}`);
    return url(key);
  };
  const resolve = (ref: FrameRef) => {
    if ("photo" in ref) return url(ref.photo === "survivor" ? spec.survivorKey : spec.infectedKey);
    if ("frame" in ref) return need(ref.frame);
    const key = scene.assets[ref.asset];
    if (!key) throw new Error(`scene ${scene.id} has no asset ${ref.asset}`);
    return url(`assets/${key}`);
  };
  if (step.id.startsWith("kf:")) {
    const k = keyframe(story, frameOf(step.id));
    return {
      prompt: k.prompt(spec.scene, spec.kind),
      images: await Promise.all(k.refs.map(resolve)),
    };
  }
  const shot = story.storyboard(spec.kind).find((s) => `shot:${s.id}` === step.id);
  if (!shot || "clip" in shot.first || !shot.prompt)
    throw new Error(`no kie input for step ${step.id}`);
  return {
    prompt: shot.prompt(spec.scene, spec.kind),
    images: [],
    first: await need(shot.first.frame),
    ...(shot.last ? { last: await need(shot.last.frame) } : {}),
    targetSec: shot.sec,
  };
}
