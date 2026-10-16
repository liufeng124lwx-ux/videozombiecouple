import type { Kind } from "../story.ts";
import type { Story } from "./types.ts";

/** Film length: every shot plus the held last frame. */
export function totalSecondsOf(story: Story, kind: Kind): number {
  return story.storyboard(kind).reduce((t, s) => t + s.sec, 0) + story.holdSec;
}
