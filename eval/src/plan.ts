// Pure planning: which keyframe / shot jobs to run, from pairs, models and picks.json.
import { join } from "node:path";
import type { Pair } from "./personas.ts";
import type { ImageCandidate, VideoCandidate } from "./candidates.ts";
import { pickSeconds } from "./candidates.ts";
import { keyframePrompt, shotPrompt, type FrameId, type ShotDef } from "./storyboard.ts";

export type Picks = Record<string, Record<string, Partial<Record<FrameId, string>>>>;
export type KfSpec = { key: string; pair: Pair; model: ImageCandidate; frame: FrameId; cand: number; refs: string[]; prompt: string; out: string };
export type ShotSpec = { key: string; pair: Pair; model: VideoCandidate; shot: ShotDef; sec: number; first: string; last?: string; prompt: string; out: string };

export function planKeyframes(o: {
  pairs: Pair[];
  models: ImageCandidate[];
  stage: "AC" | "B";
  candidates: number;
  dataDir: string;
  runDir: string;
  picks: Picks;
}): { specs: KfSpec[]; missing: string[] } {
  const specs: KfSpec[] = [];
  const missing: string[] = [];
  const frames: FrameId[] = o.stage === "AC" ? ["A", "C"] : ["B"];
  const count = o.stage === "AC" ? o.candidates : 1;
  for (const pair of o.pairs) {
    const photos = [join(o.dataDir, pair.survivor), join(o.dataDir, pair.infected)];
    for (const model of o.models) {
      let refs = photos;
      if (o.stage === "B") {
        const p = o.picks[pair.id]?.[model.key];
        if (!p?.A || !p?.C) {
          missing.push(`${pair.id}/${model.key}`);
          continue;
        }
        refs = [...photos, p.A, p.C];
      }
      for (const frame of frames) {
        for (let cand = 1; cand <= count; cand++) {
          specs.push({
            key: `${model.key}|${pair.id}|${frame}|${cand}`,
            pair,
            model,
            frame,
            cand,
            refs,
            prompt: keyframePrompt(frame, pair.kind),
            out: join(o.runDir, "kf", model.key, pair.id, `${frame}-${cand}.jpg`),
          });
        }
      }
    }
  }
  return { specs, missing };
}

export function planShots(o: {
  pairs: Pair[];
  models: VideoCandidate[];
  shots: ShotDef[];
  kfModel: string;
  runDir: string;
  picks: Picks;
}): { specs: ShotSpec[]; missing: string[] } {
  const specs: ShotSpec[] = [];
  const missing: string[] = [];
  for (const pair of o.pairs) {
    const p = o.picks[pair.id]?.[o.kfModel];
    const needed = new Set(o.shots.flatMap((s) => (s.last ? [s.first, s.last] : [s.first])));
    if (!p || [...needed].some((f) => !p[f])) {
      missing.push(`${pair.id}/${o.kfModel}`);
      continue;
    }
    for (const model of o.models) {
      for (const shot of o.shots) {
        specs.push({
          key: `${o.kfModel}|${model.key}|${pair.id}|${shot.id}`,
          pair,
          model,
          shot,
          sec: pickSeconds(model, shot.targetSec),
          first: p[shot.first]!,
          last: shot.last ? p[shot.last] : undefined,
          prompt: shotPrompt(shot.id, pair.kind),
          out: join(o.runDir, "shots", model.key, pair.id, `shot${shot.id}.mp4`),
        });
      }
    }
  }
  return { specs, missing };
}
