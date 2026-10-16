import { CHRISTMAS } from "./christmas.ts";
import type { Story, StoryId } from "./types.ts";
import { ZOMBIE } from "./zombie.ts";

export { CHRISTMAS } from "./christmas.ts";
export * from "./types.ts";
export { CAPTION_LINE1, ZOMBIE } from "./zombie.ts";

export const STORIES: Readonly<Record<StoryId, Story>> = { zombie: ZOMBIE, christmas: CHRISTMAS };

/** The story of a film; records made before stories existed are zombie films. */
export function storyOf(spec: { story?: StoryId }): Story {
  return STORIES[spec.story ?? "zombie"];
}

/** A scene's label in any story; unknown ids are shown as they are. */
export function sceneLabel(scene: string): string {
  for (const story of Object.values(STORIES)) {
    const found = story.scenes[scene];
    if (found) return found.label;
  }
  return scene;
}

export { totalSecondsOf, totalSecondsOf as totalSeconds } from "./length.ts";
export { validateStory } from "./validate.ts";
