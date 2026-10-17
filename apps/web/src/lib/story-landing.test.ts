import { CHRISTMAS, fact, STORIES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { CHRISTMAS_PAIR, samplePair, ZOMBIE_FILMS } from "./samples.ts";
import {
  clock,
  heroFilm,
  ogFrames,
  pickerFilms,
  storyBeats,
  storyFilms,
  storySamples,
  toolFilms,
} from "./story-landing.ts";

describe("story beats (showcase spec §5.3: what happens in your N seconds)", () => {
  const beats = storyBeats("christmas");
  const shots = CHRISTMAS.storyboard("human");

  it("has three beats, as the page frontmatter does", () => {
    expect(beats).toHaveLength(3);
  });

  it("covers every storyboard shot once, in order", () => {
    expect(beats.flatMap((b) => b.shots)).toEqual(shots.map((s) => s.id));
  });

  it("times each beat from the storyboard and ends at the film's length", () => {
    expect(beats[0]?.start).toBe(0);
    for (let i = 1; i < beats.length; i++) expect(beats[i]?.start).toBe(beats[i - 1]?.end);
    const end = beats.at(-1)?.end ?? 0;
    expect(String(end)).toBe(fact("story.christmas.seconds"));
    const first = beats[0];
    const firstSec = shots
      .filter((s) => first?.shots.includes(s.id))
      .reduce((t, s) => t + s.sec, 0);
    expect(first?.end).toBe(firstSec);
  });

  it("quotes the film's own lines in the beat they appear in", () => {
    const lines = beats.flatMap((b) => b.lines);
    expect(lines).toEqual(CHRISTMAS.overlays.map((o) => o.text));
    for (const beat of beats)
      for (const line of beat.lines) {
        const overlay = CHRISTMAS.overlays.find((o) => o.text === line);
        expect(overlay?.start).toBeGreaterThanOrEqual(beat.start);
        expect(overlay?.start).toBeLessThan(beat.end);
      }
  });

  it("writes times as m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(10)).toBe("0:10");
    expect(clock(75)).toBe("1:15");
  });

  it("the zombie story keeps its own beat section (no timeline)", () => {
    expect(storyBeats("zombie")).toEqual([]);
  });
});

describe("story samples (showcase spec §6)", () => {
  it("shows one Christmas film per live scene", () => {
    const live = Object.values(STORIES.christmas.scenes)
      .filter((s) => s.live)
      .map((s) => s.id);
    expect(storySamples("christmas").map((s) => s.film.scene)).toEqual(live);
  });

  it("labels each sample as an AI example of its eval persona", () => {
    for (const s of storySamples("christmas")) {
      expect(s.alt).toMatch(/^AI example: /);
      expect(s.alt).toContain(samplePair(s.film.pair)?.who ?? "missing");
      expect(s.scene).toBe(STORIES.christmas.scenes[s.film.scene]?.label);
    }
    const flat = storySamples("christmas").find((s) => s.film.id === "xmas-city-flat");
    expect(flat?.alt).toContain(CHRISTMAS_PAIR.who);
  });

  it("gives the tool one poster per Christmas scene, and the zombie tool its old ones", () => {
    expect(toolFilms("christmas").map((f) => f.scene)).toEqual(["snow-cabin", "city-flat"]);
    expect(toolFilms("zombie")).toEqual(ZOMBIE_FILMS.filter((f) => f.kind === "human"));
    expect(storyFilms("zombie")).toEqual(ZOMBIE_FILMS);
    expect(storyFilms("christmas").every((f) => f.story === "christmas")).toBe(true);
  });
});

describe("hero film (carry-over ruling: never fall back silently)", () => {
  it("uses the film the frontmatter names, Christmas ones included", () => {
    expect(heroFilm("xmas-city-flat", "christmas").id).toBe("xmas-city-flat");
    expect(heroFilm("xmas-snow-cabin", "zombie").id).toBe("xmas-snow-cabin");
    expect(heroFilm("chapel", "zombie").id).toBe("chapel");
  });

  it("defaults to the story's first film: the zombie cabin as before, the snow cabin for Christmas", () => {
    expect(heroFilm(undefined, "zombie").id).toBe("cabin");
    expect(heroFilm(undefined, "christmas").id).toBe("xmas-snow-cabin");
  });

  it("throws on an unknown film", () => {
    expect(() => heroFilm("xmas-farmhouse", "christmas")).toThrow(/xmas-farmhouse/);
  });
});

describe("share image frames", () => {
  it("keep the zombie pages' standoff and memory frames", () => {
    expect(ogFrames("zombie")).toEqual({
      sample: { before: "p03-A.jpg", after: "p03-C.jpg" },
      labels: { before: "og.before", after: "og.after" },
    });
  });

  it("use the Christmas film's opening and memory frames on the Christmas page", () => {
    expect(ogFrames("christmas")).toEqual({
      sample: {
        before: "film-xmas-snow-cabin-poster.jpg",
        after: "film-xmas-snow-cabin-memory.jpg",
      },
      labels: { before: "christmas.og.before", after: "christmas.og.after" },
    });
  });
});

describe("scene posters on the /story?id= page (it can open any story)", () => {
  it("has a film for every live scene of every story, and nothing else", () => {
    const live = Object.values(STORIES).flatMap((story) =>
      Object.values(story.scenes)
        .filter((scene) => scene.live)
        .map((scene) => scene.id),
    );
    const films = pickerFilms();
    expect(films.map((f) => f.scene).sort()).toEqual([...live].sort());
    expect(films.every((f) => f.kind === "human")).toBe(true);
    expect(films.map((f) => f.id)).toEqual(
      expect.arrayContaining(["xmas-snow-cabin", "xmas-city-flat"]),
    );
  });
});
