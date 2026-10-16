import { KINDS } from "../story.ts";
import { totalSecondsOf } from "./length.ts";
import type { Story } from "./types.ts";

/** Problems with a story's data; empty when it is well formed. */
export function validateStory(story: Story): string[] {
  const errors: string[] = [];
  const order = story.keyframes.map((k) => k.id);
  if (new Set(order).size !== order.length) errors.push("duplicate keyframe ids");
  if (story.credits <= 0) errors.push("credits must be positive");
  if (story.kinds.length === 0) errors.push("no kinds");
  const assetsUsed = new Set<string>();
  story.keyframes.forEach((k, i) => {
    if (k.candidates < 1) errors.push(`keyframe ${k.id} needs at least one image`);
    for (const ref of k.refs) {
      if ("asset" in ref) assetsUsed.add(ref.asset);
      if (!("frame" in ref)) continue;
      const at = order.indexOf(ref.frame);
      if (at === -1) errors.push(`keyframe ${k.id} refers to unknown frame ${ref.frame}`);
      else if (at >= i) errors.push(`keyframe ${k.id} refers to ${ref.frame} before it is made`);
    }
  });
  for (const kind of KINDS.filter((k) => story.kinds.includes(k))) {
    const shots = story.storyboard(kind);
    if (new Set(shots.map((s) => s.id)).size !== shots.length)
      errors.push(`${kind}: duplicate shot ids`);
    for (const s of shots) {
      if (s.sec <= 0) errors.push(`${kind}: shot ${s.id} has no length`);
      if ("clip" in s.first) assetsUsed.add(s.first.clip);
      else if (!order.includes(s.first.frame))
        errors.push(`${kind}: shot ${s.id} starts on unknown frame ${s.first.frame}`);
      if (s.last && !order.includes(s.last.frame))
        errors.push(`${kind}: shot ${s.id} ends on unknown frame ${s.last.frame}`);
      if (!("clip" in s.first) && !s.prompt) errors.push(`${kind}: shot ${s.id} has no prompt`);
    }
    const total = totalSecondsOf(story, kind);
    for (const o of story.overlays)
      if (o.start < 0 || o.end <= o.start || o.end > total)
        errors.push(`${kind}: overlay "${o.text}" is outside the film`);
    if (story.titleAt !== null && (story.titleAt < 0 || story.titleAt >= total))
      errors.push(`${kind}: the title starts outside the film`);
  }
  for (const sc of Object.values(story.scenes))
    for (const name of assetsUsed)
      if (!sc.assets[name]) errors.push(`asset "${name}" missing in scene ${sc.id}`);
  return errors;
}
