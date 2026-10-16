import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  KINDS,
  keyframePrompt,
  SCENE_IDS,
  SCENES,
  STORIES,
  STORYBOARD,
  sceneLabel,
  shotPrompt,
  storyboard,
  storyOf,
  totalSeconds,
  validateStory,
  ZOMBIE,
} from "../src/index.ts";

describe("the zombie story as data", () => {
  it("keeps every keyframe prompt of story.ts, in the order A, C, B", () => {
    expect(ZOMBIE.keyframes.map((k) => k.id)).toEqual(["A", "C", "B"]);
    for (const scene of SCENE_IDS)
      for (const kind of KINDS)
        for (const k of ZOMBIE.keyframes)
          expect(k.prompt(scene, kind)).toBe(keyframePrompt(scene, k.id as "A" | "B" | "C", kind));
  });

  it("scores two candidates of A and C; B is one image from the photos, A and C", () => {
    const [a, c, b] = ZOMBIE.keyframes;
    expect([a?.candidates, c?.candidates, b?.candidates]).toEqual([
      CANDIDATES_PER_FRAME,
      CANDIDATES_PER_FRAME,
      1,
    ]);
    expect(b?.refs).toEqual([
      { photo: "survivor" },
      { photo: "infected" },
      { frame: "A" },
      { frame: "C" },
    ]);
    expect(a?.faces).toEqual(["infected"]);
    expect(c?.faces).toEqual(["survivor", "infected"]);
    expect([a?.petFaces, c?.petFaces, b?.petFaces]).toEqual([[], ["survivor"], ["survivor"]]);
  });

  it("keeps the storyboard and shot prompts for both kinds", () => {
    for (const kind of KINDS) {
      const legacy = storyboard(kind);
      const shots = ZOMBIE.storyboard(kind);
      expect(shots.map((s) => [s.id, s.sec, s.first, s.last, s.grade])).toEqual(
        legacy.map((s) => [
          s.id,
          s.targetSec,
          { frame: s.first },
          s.last ? { frame: s.last } : undefined,
          s.grade,
        ]),
      );
      for (const scene of SCENE_IDS)
        for (const s of shots)
          expect(s.prompt?.(scene, kind)).toBe(shotPrompt(scene, s.id as 1, kind));
    }
  });

  it("is 15 seconds with the held title, no overlays, the old end title", () => {
    expect(totalSeconds(ZOMBIE, "human")).toBe(
      STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC,
    );
    expect(ZOMBIE.overlays).toEqual([]);
    expect(ZOMBIE.titleAt).toBeNull();
    expect(ZOMBIE.credits).toBe(10);
    expect(ZOMBIE.title({ names: "Tom & Amy", date: "2019", createdAt: 0 })).toEqual({
      line1: "Even at the end of the world.",
      line2: "Tom & Amy · 2019",
      line3: null,
    });
    expect(ZOMBIE.title({ names: null, date: null, createdAt: 0 }).line2).toBeNull();
  });

  it("has the same scenes and music", () => {
    for (const id of SCENE_IDS)
      expect(ZOMBIE.scenes[id]).toEqual({
        id,
        label: SCENES[id].label,
        live: SCENES[id].live,
        musicKey: SCENES[id].musicKey,
        assets: {},
      });
  });
});

describe("the story registry", () => {
  it("finds a story, and old records without one are zombie films", () => {
    expect(storyOf({})).toBe(ZOMBIE);
    expect(storyOf({ story: "zombie" })).toBe(ZOMBIE);
    expect(sceneLabel("cabin-wheat")).toBe(SCENES["cabin-wheat"].label);
    expect(sceneLabel("nowhere")).toBe("nowhere");
  });

  it("every story is well formed", () => {
    for (const story of Object.values(STORIES)) expect(validateStory(story), story.id).toEqual([]);
  });

  it("the validator catches a missing frame, a forward reference and an unknown asset", () => {
    const broken = {
      ...ZOMBIE,
      keyframes: [
        { ...ZOMBIE.keyframes[2], id: "B" },
        { ...ZOMBIE.keyframes[0], id: "A", refs: [{ asset: "ornament" }] },
      ],
    } as typeof ZOMBIE;
    const errors = validateStory(broken);
    expect(errors.join("\n")).toMatch(/keyframe B refers to A before it is made/);
    expect(errors.join("\n")).toMatch(/keyframe B refers to unknown frame C/);
    expect(errors.join("\n")).toMatch(/asset "ornament" missing in scene cabin-wheat/);
  });
});
