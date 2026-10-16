import { describe, expect, it } from "vitest";
import { CHRISTMAS, STORIES, storyOf, totalSeconds, validateStory } from "../src/index.ts";

describe("50 Christmases", () => {
  it("is well formed, 32 seconds, 20 credits, people only, not orderable yet", () => {
    expect(validateStory(CHRISTMAS)).toEqual([]);
    expect(totalSeconds(CHRISTMAS, "human")).toBe(32);
    expect(CHRISTMAS.credits).toBe(20);
    expect(CHRISTMAS.kinds).toEqual(["human"]);
    expect(Object.keys(CHRISTMAS.scenes)).toEqual(["snow-cabin", "city-flat", "farmhouse"]);
    expect(Object.values(CHRISTMAS.scenes).every((s) => !s.live)).toBe(true);
    expect(STORIES.christmas).toBe(CHRISTMAS);
    expect(storyOf({ story: "christmas" })).toBe(CHRISTMAS);
  });

  it("follows the storyboard: hook first, the hands and the window are scene clips", () => {
    const shots = CHRISTMAS.storyboard("human");
    expect(shots.map((s) => s.sec)).toEqual([3, 3, 4, 3, 4, 3, 4, 4, 4]);
    expect(shots.map((s) => ("clip" in s.first ? `clip:${s.first.clip}` : s.first.frame))).toEqual([
      "forgetCold",
      "rememberClose",
      "wide",
      "clip:hands",
      "tree",
      "forgetWarm",
      "memory",
      "embrace",
      "clip:window",
    ]);
    expect(shots.map((s) => s.grade)).toEqual([
      "cold",
      "cold",
      "cold",
      "cold",
      "cold",
      "amber",
      "golden",
      "amber-dawn",
      "amber-dawn",
    ]);
    expect(shots.filter((s) => s.flash).map((s) => s.id)).toEqual([7]);
  });

  it("scores the wide shot and the memory; everything else builds on the wide shot", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    expect(byId.wide?.candidates).toBe(2);
    expect(byId.memory?.candidates).toBe(2);
    expect(byId.forgetCold?.refs).toEqual([{ photo: "infected" }, { frame: "wide" }]);
    expect(byId.rememberClose?.refs).toEqual([{ photo: "survivor" }, { frame: "wide" }]);
    expect(byId.forgetWarm?.refs).toEqual([{ photo: "infected" }, { frame: "forgetCold" }]);
    expect(byId.tree?.refs).toContainEqual({ asset: "ornament" });
    expect(byId.memory?.refs).toContainEqual({ asset: "ornament" });
    expect(CHRISTMAS.keyframes.reduce((n, k) => n + k.candidates, 0)).toBe(9);
  });

  it("says the hook and the turn on screen, without guessing anyone's gender", () => {
    expect(CHRISTMAS.overlays).toEqual([
      { text: "Our 50th Christmas. Today, you asked me my name.", start: 0, end: 5 },
      { text: "So I brought back our first one.", start: 10, end: 13 },
    ]);
    for (const o of CHRISTMAS.overlays) expect(o.text).not.toMatch(/\b(she|he|her|his|him)\b/i);
    expect(CHRISTMAS.holdSec).toBe(0);
    expect(CHRISTMAS.titleAt).toBe(30);
  });

  it("puts the year of the date on the end title, else the year the film was ordered", () => {
    const at = Date.UTC(2026, 11, 1);
    expect(CHRISTMAS.title({ names: "Tom & Amy", date: "Dec 24, 2019", createdAt: at })).toEqual({
      line1: "Our first Christmas · 2019",
      line2: "and every one after.",
      line3: "Tom & Amy",
    });
    expect(CHRISTMAS.title({ names: null, date: "Dec 24", createdAt: at }).line1).toBe(
      "Our first Christmas · 2026",
    );
    expect(CHRISTMAS.title({ names: null, date: null, createdAt: at })).toEqual({
      line1: "Our first Christmas · 2026",
      line2: "and every one after.",
      line3: null,
    });
  });

  it("every prompt keeps people recognizable and avoids what the models do badly", () => {
    for (const scene of Object.keys(CHRISTMAS.scenes)) {
      for (const k of CHRISTMAS.keyframes) {
        const p = k.prompt(scene, "human");
        expect(p, k.id).toContain(
          "No text, no glasses, no exaggerated crying, no distorted hands.",
        );
        if (k.id !== "memory") expect(p, k.id).toMatch(/aged to about 78/);
        else expect(p).not.toMatch(/aged/);
      }
      for (const s of CHRISTMAS.storyboard("human"))
        if (s.prompt)
          expect(s.prompt(scene, "human")).toContain(
            "Faces stay consistent with the reference people.",
          );
    }
    expect(CHRISTMAS.keyframes[0]?.prompt("city-flat", "human")).not.toBe(
      CHRISTMAS.keyframes[0]?.prompt("snow-cabin", "human"),
    );
  });
});
