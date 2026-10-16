import type { StoryId } from "./stories/types.ts";
import type { Kind } from "./story.ts";

/** Routes may differ per kind (planRoutes' mode): human couples or a person and a pet. */
export type ModeId = Kind;

/** Bump a version whenever its prompts change; it is stored on every story. */
export const MODES: Record<ModeId, { promptVersion: string }> = {
  human: { promptVersion: "h1" },
  pet: { promptVersion: "p1" },
};

/** The prompt version stored on every story (christmas content spec §3). */
export function promptVersionOf(story: StoryId, kind: ModeId): string {
  return story === "christmas" ? "c1" : MODES[kind].promptVersion;
}
