import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  KINDS,
  keyframePrompt,
  PHOTO,
  portraitPrompt,
  SALE_PRODUCTS,
  SCENE_IDS,
  SCENES,
  STORYBOARD,
  shotPrompt,
  storyboard,
  TIERS,
  VIDEO_PACKS,
} from "../src/index.ts";

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";

describe("story catalog", () => {
  it("storyboard plus the held title is 15 seconds; shot 3 runs A→B, shot 5 returns to B at dawn", () => {
    expect(STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC).toBe(15);
    expect(STORYBOARD.find((s) => s.id === 5)).toMatchObject({
      first: "B",
      grade: "dawn",
      targetSec: 3,
    });
    expect(STORYBOARD.map((s) => s.grade)).toEqual(["cold", "cold", "cold", "warm", "dawn"]);
    expect(STORYBOARD.find((s) => s.id === 3)).toMatchObject({
      first: "A",
      last: "B",
      targetSec: 3,
    });
    // Kling's shortest clip is 3 s: the embrace shot fits without a cut.
    expect(STORYBOARD.map((s) => s.targetSec)).toEqual([3, 2, 3, 3, 3]);
  });

  it("the pet version's embrace starts in the arms: a cat crossing the room into a hug morphs", () => {
    expect(storyboard("human")).toEqual(STORYBOARD);
    const pet = storyboard("pet");
    expect(pet.map((s) => s.targetSec)).toEqual(STORYBOARD.map((s) => s.targetSec));
    const shot3 = pet.find((s) => s.id === 3);
    expect(shot3).toMatchObject({ first: "B", grade: "cold", targetSec: 3 });
    expect(shot3?.last).toBeUndefined();
    const p = shotPrompt("cabin-wheat", 3, "pet");
    expect(p).not.toMatch(/steps forward|walks|opens both arms/i);
    expect(p).toMatch(/stays in (her|their|the survivor's) arms/i);
  });

  it("keyframe B keeps the clothes from the standoff (A), taking only the pose from C", () => {
    for (const kind of KINDS) {
      const p = keyframePrompt("cabin-wheat", "B", kind);
      expect(p).toMatch(/same clothes as in IMAGE 3/i);
      expect(p).toMatch(/only the pose/i);
    }
  });

  it("every prompt carries the safety line for every scene and kind", () => {
    for (const scene of SCENE_IDS)
      for (const kind of KINDS) {
        for (const f of ["A", "B", "C"] as const)
          expect(keyframePrompt(scene, f, kind)).toContain(SAFE);
        for (const s of STORYBOARD) expect(shotPrompt(scene, s.id, kind)).toContain(SAFE);
      }
  });

  it("the ending goes back to the ruins at first light and pulls away", () => {
    for (const kind of KINDS) {
      const p = shotPrompt("cabin-wheat", 5, kind);
      expect(p).toMatch(/dawn|first light/i);
      expect(p).toMatch(/pull(s)? back/i);
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
    expect(VIDEO_PACKS.map((p) => [p.id, p.credits, p.usd])).toEqual([
      ["pack1", 10, 4.99],
      ["pack3", 30, 13.99],
      ["pack5", 50, 21.99],
    ]);
    expect(SALE_PRODUCTS.every((p) => p.kind === "pack")).toBe(true);
    expect(CANDIDATES_PER_FRAME).toBe(2);
  });
});

describe("the zombie photo (AI zombie filter)", () => {
  it("uses the prompt tested in 即梦 on 2026-10-15 (v5): the same person, own skin tone, restrained", () => {
    const p = portraitPrompt();
    expect(p).toContain("The person from the reference image, turned into a zombie");
    expect(p).toContain("over their own natural skin tone");
    expect(p).toContain("never lighten or darken it");
    expect(p).toContain("instantly recognizable as the same person");
    expect(p).toContain("No blood, no gore, no wounds");
    expect(PHOTO.promptVersion).toBe("z1");
  });

  it("is one free photo a day per browser, three per network, kept a day", () => {
    expect(PHOTO.freePerVisitorDay).toBe(1);
    expect(PHOTO.freePerIpDay).toBe(3);
    expect(PHOTO.keepHours).toBe(24);
  });
});
