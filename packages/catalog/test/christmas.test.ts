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

  it("scores the wide shot, the memory and both close-ups; close-ups use only their own photo", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    for (const id of ["wide", "memory", "forgetCold", "rememberClose"])
      expect(byId[id]?.candidates, id).toBe(2);
    expect(byId.forgetCold?.refs).toEqual([{ photo: "infected" }]);
    expect(byId.rememberClose?.refs).toEqual([{ photo: "survivor" }]);
    expect(byId.forgetWarm?.refs).toEqual([{ photo: "infected" }, { frame: "forgetCold" }]);
    expect(byId.tree?.refs).toEqual([
      { photo: "survivor" },
      { photo: "infected" },
      { frame: "wide" },
      { asset: "ornament" },
    ]);
    expect(byId.embrace?.refs).toEqual([
      { photo: "survivor" },
      { photo: "infected" },
      { frame: "tree" },
    ]);
    expect(CHRISTMAS.keyframes.reduce((n, k) => n + k.candidates, 0)).toBe(11);
    expect(CHRISTMAS.describe).toBe(true);
  });

  it("shares the ornament and the hands clip across scenes; each scene has its own window and music", () => {
    const scenes = Object.values(CHRISTMAS.scenes);
    expect(new Set(scenes.map((s) => s.assets.ornament))).toEqual(
      new Set(["stories/christmas/shared/ornament.jpg"]),
    );
    expect(new Set(scenes.map((s) => s.assets.hands))).toEqual(
      new Set(["stories/christmas/shared/hands.mp4"]),
    );
    expect(new Set(scenes.map((s) => s.assets.window)).size).toBe(3);
    expect(new Set(scenes.map((s) => s.musicKey)).size).toBe(3);
  });

  it("puts each person's appearance line into the frames that redraw them, and nothing when it is empty", () => {
    const look = { survivor: "full beard", infected: "blue floral headscarf covering all hair" };
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    const wide = byId.wide?.prompt("snow-cabin", "human", look) ?? "";
    expect(wide).toContain("full beard");
    expect(wide).toContain("blue floral headscarf covering all hair");
    expect(byId.forgetCold?.prompt("snow-cabin", "human", look)).toContain("headscarf");
    expect(byId.forgetCold?.prompt("snow-cabin", "human", look)).not.toContain("full beard");
    expect(byId.rememberClose?.prompt("snow-cabin", "human", look)).toContain("full beard");
    for (const k of CHRISTMAS.keyframes) {
      const plain = k.prompt("snow-cabin", "human");
      expect(plain, k.id).not.toMatch(/Appearance to keep/);
      // The generic hair / head-covering clauses failed in 即梦 (research notes §9–10).
      expect(plain, k.id).not.toMatch(/silver-white hair|head covering|beard if they have one/);
    }
  });

  it("follows the 即梦 rules: who to look at, gender, one ornament", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    expect(byId.wide?.prompt("snow-cabin", "human")).toContain("not at the other person");
    expect(byId.wide?.prompt("snow-cabin", "human")).toContain("unmistakably elderly");
    for (const id of ["forgetCold", "rememberClose", "forgetWarm"])
      expect(byId[id]?.prompt("snow-cabin", "human"), id).toContain("the same gender as IMAGE 1");
    for (const id of ["tree", "embrace"])
      expect(byId[id]?.prompt("snow-cabin", "human"), id).toContain(
        "only this one heart ornament on the tree",
      );
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
        if (["wide", "forgetCold", "rememberClose"].includes(k.id))
          expect(p, k.id).toMatch(/late seventies/);
        else if (k.id !== "memory") expect(p, k.id).toMatch(/grown old/);
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
