import type { Story } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** A scene can be ordered when it is live, or on staging when PREVIEW_SCENES names it (christmas content plan, Task 6). */
export function isOrderable(
  env: Pick<Bindings, "ENVIRONMENT" | "PREVIEW_SCENES">,
  story: Story,
  sceneId: string,
): boolean {
  const scene = story.scenes[sceneId];
  if (!scene) return false;
  if (scene.live) return true;
  if (env.ENVIRONMENT !== "staging") return false;
  const listed = (env.PREVIEW_SCENES ?? "").split(",").map((s) => s.trim());
  return listed.includes(`${story.id}/${sceneId}`);
}
