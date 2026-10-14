import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  KINDS,
  keyframePrompt,
  PACKS,
  SALE_PRODUCTS,
  SCENE_IDS,
  SCENES,
  STORYBOARD,
  shotPrompt,
  TIERS,
} from "../src/index.ts";

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";

describe("story catalog", () => {
  it("storyboard plus caption is 12 seconds and shot 3 runs A→B", () => {
    expect(STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC).toBe(12);
    expect(STORYBOARD.find((s) => s.id === 3)).toMatchObject({ first: "A", last: "B" });
  });

  it("every prompt carries the safety line for every scene and kind", () => {
    for (const scene of SCENE_IDS)
      for (const kind of KINDS) {
        for (const f of ["A", "B", "C"] as const)
          expect(keyframePrompt(scene, f, kind)).toContain(SAFE);
        for (const s of STORYBOARD) expect(shotPrompt(scene, s.id, kind)).toContain(SAFE);
      }
  });

  it("pet prompts never mention a gun", () => {
    for (const scene of SCENE_IDS) {
      for (const f of ["A", "B", "C"] as const)
        expect(keyframePrompt(scene, f, "pet")).not.toMatch(/pistol|\bgun\b/i);
      for (const s of STORYBOARD)
        expect(shotPrompt(scene, s.id, "pet")).not.toMatch(/pistol|\bgun\b/i);
    }
  });

  it("scenes swap the setting, not the story", () => {
    expect(keyframePrompt("rain-chapel", "A", "human")).not.toBe(
      keyframePrompt("cabin-wheat", "A", "human"),
    );
    expect(SCENES["cabin-wheat"].live).toBe(true);
  });

  it("only video packs are sold, and a video costs 10 credits", () => {
    expect(TIERS.video.credits).toBe(10);
    expect(PACKS.map((p) => [p.id, p.credits, p.usd])).toEqual([
      ["pack1", 10, 4.99],
      ["pack3", 30, 11.99],
      ["pack10", 100, 29.99],
    ]);
    expect(SALE_PRODUCTS.every((p) => p.kind === "pack")).toBe(true);
    expect(CANDIDATES_PER_FRAME).toBe(2);
  });
});
