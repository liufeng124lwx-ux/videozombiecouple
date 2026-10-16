import { describe, expect, it } from "vitest";
import {
  APPEARANCE_MARK,
  CHRISTMAS,
  STORIES,
  storyOf,
  totalSeconds,
  validateStory,
} from "../src/index.ts";

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
      expect(plain, k.id).not.toContain(APPEARANCE_MARK);
      // The generic hair / head-covering clauses failed in 即梦 (research notes §9–10).
      expect(plain, k.id).not.toMatch(/silver-white hair|head covering|beard if they have one/);
    }
  });

  it("writes each appearance as its own sentence: aged for old frames, plain for the memory", () => {
    const look = { survivor: "short dark hair, full beard", infected: "blue floral headscarf" };
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    const aged = (n: number, line: string) =>
      `${APPEARANCE_MARK} ${n}, now fifty years older with any visible hair or beard turned white or silver: ${line}.`;
    expect(APPEARANCE_MARK).toBe("Visible features of the person from IMAGE");
    const wide = byId.wide?.prompt("snow-cabin", "human", look) ?? "";
    expect(wide).toContain(aged(1, look.survivor));
    expect(wide).toContain(aged(2, look.infected));
    const memory = byId.memory?.prompt("snow-cabin", "human", look) ?? "";
    expect(memory).toContain(`${APPEARANCE_MARK} 1: ${look.survivor}.`);
    expect(memory).toContain(`${APPEARANCE_MARK} 2: ${look.infected}.`);
    expect(memory).not.toContain("fifty years older with any visible hair");
    expect(memory).toContain(
      "Each person keeps the face, hair, age, skin tone and gender of their own photo exactly.",
    );
    expect(byId.forgetCold?.prompt("snow-cabin", "human", look)).toContain(aged(1, look.infected));
    expect(byId.rememberClose?.prompt("snow-cabin", "human", look)).toContain(
      aged(1, look.survivor),
    );
    expect(byId.forgetWarm?.prompt("snow-cabin", "human", look)).toContain(aged(1, look.infected));
    for (const id of ["tree", "embrace"]) {
      const p = byId[id]?.prompt("snow-cabin", "human", look) ?? "";
      expect(p, id).toContain(aged(1, look.survivor));
      expect(p, id).toContain(aged(2, look.infected));
    }
    for (const k of CHRISTMAS.keyframes) {
      const half = k.prompt("snow-cabin", "human", { survivor: "full beard", infected: "" });
      expect(half, k.id).not.toContain("Appearance to keep");
      expect(half, k.id).not.toMatch(/IMAGE 2[^.]*now fifty years older with any visible hair/);
    }
  });

  it("follows the 即梦 rules: composition, age, gender, skin tone, one ornament", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    const get = (id: string) => byId[id]?.prompt("snow-cabin", "human") ?? "";
    const wide = get("wide");
    expect(wide).toContain("eyes fixed on the snow");
    expect(wide).toContain("back to the doorway");
    expect(wide).toContain("seen in profile from the side");
    expect(wide).toContain(
      "stands in the doorway behind the armchair, unseen by the seated person",
    );
    expect(wide).toContain("an armchair facing the window with its back to the doorway");
    expect(wide).not.toContain("an armchair by the window");
    expect(wide).toContain("Never swap the two people.");
    for (const id of ["wide", "forgetCold", "rememberClose"])
      expect(get(id), id).toContain("late seventies");
    for (const id of ["tree", "forgetWarm", "embrace"]) expect(get(id), id).toContain("grown old");
    expect(get("wide")).toContain("unmistakably elderly");
    expect(get("forgetWarm")).toContain("the same gender as IMAGE 1");
    for (const id of ["forgetCold", "rememberClose"]) {
      expect(get(id), id).toContain("features and gender of IMAGE 1");
      // said once, not twice
      expect(get(id).match(/gender/g), id).toHaveLength(1);
      // a close-up has no armchair in frame
      expect(get(id), id).not.toContain("armchair");
    }
    for (const id of ["tree", "embrace"])
      expect(get(id), id).toContain("only this one heart ornament on the tree");
    for (const id of ["wide", "forgetCold", "rememberClose"])
      expect(get(id), id).toContain("and the skin exactly as dark or as light as in IMAGE");
    for (const id of ["wide", "forgetCold", "rememberClose", "tree", "forgetWarm", "embrace"])
      expect(get(id), id).toContain("never lighter or darker");
  });

  it("uses no gendered pronouns in any keyframe or shot prompt", () => {
    const look = { survivor: "full beard", infected: "blue floral headscarf" };
    for (const scene of Object.keys(CHRISTMAS.scenes)) {
      for (const k of CHRISTMAS.keyframes)
        expect(k.prompt(scene, "human", look), `${scene}/${k.id}`).not.toMatch(
          /\b(she|he|her|hers|his|him|herself|himself)\b/i,
        );
      for (const sh of CHRISTMAS.storyboard("human"))
        if (sh.prompt)
          expect(sh.prompt(scene, "human"), `${scene}/shot ${sh.id}`).not.toMatch(
            /\b(she|he|her|hers|his|him|herself|himself)\b/i,
          );
    }
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
        expect(p, k.id).toContain("No text, no exaggerated crying, no distorted hands.");
        // nothing about glasses unless a describe line says so
        expect(p, k.id).not.toMatch(/glasses/);
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

  it("never says no glasses when a person wears them; the line carries them", () => {
    const look = { survivor: "short dark hair, round glasses", infected: "long red hair" };
    for (const scene of Object.keys(CHRISTMAS.scenes))
      for (const k of CHRISTMAS.keyframes) {
        const p = k.prompt(scene, "human", look);
        expect(p, k.id).not.toContain("no glasses");
        if (k.refs.some((r) => "photo" in r && r.photo === "survivor"))
          expect(p, k.id).toContain("round glasses");
      }
  });

  it("starts every sentence with a capital letter", () => {
    const look = { survivor: "full beard", infected: "blue floral headscarf" };
    for (const scene of Object.keys(CHRISTMAS.scenes))
      for (const k of CHRISTMAS.keyframes)
        for (const l of [undefined, look]) {
          const p = k.prompt(scene, "human", l);
          for (const sentence of p.split(/(?<=\.)\s+/))
            expect(sentence, `${scene}/${k.id}: ${sentence}`).toMatch(/^[^a-z]/);
        }
  });

  it("keeps the memory frame young: no aging words in it", () => {
    const look = { survivor: "short dark hair", infected: "long red hair" };
    const memory = CHRISTMAS.keyframes.find((k) => k.id === "memory");
    for (const l of [undefined, look]) {
      const p = memory?.prompt("snow-cabin", "human", l) ?? "";
      expect(p).not.toMatch(/fifty years older|late seventies|grown old|elderly/);
    }
  });
});
