import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { STORIES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import {
  filmLoop,
  filmMemory,
  filmPoster,
  filmSrc,
  HERO_PAIR,
  SAMPLE_FILMS,
  SAMPLE_PAIRS,
  sampleAlt,
  sampleFile,
  samplePair,
  ZOMBIE_FILMS,
} from "./samples.ts";

const ASSETS = join(import.meta.dirname, "../assets/samples");
const PUBLIC = join(import.meta.dirname, "../../public");

describe("sample media", () => {
  it("has every frame and both source photos for each pair, with alt text", () => {
    for (const pair of SAMPLE_PAIRS)
      for (const frame of ["A", "B", "C", "survivor", "infected"] as const) {
        expect(existsSync(join(ASSETS, sampleFile(pair.id, frame))), `${pair.id}-${frame}`).toBe(
          true,
        );
        expect(sampleAlt(pair, frame)).toMatch(/AI example/);
      }
  });

  it("keeps source frames small enough to ship and the hero pair listed", () => {
    expect(SAMPLE_PAIRS.some((p) => p.id === HERO_PAIR)).toBe(true);
    for (const pair of SAMPLE_PAIRS)
      expect(statSync(join(ASSETS, sampleFile(pair.id, "A"))).size).toBeLessThan(400_000);
  });

  it("ships sample films under 2 MB with a poster", () => {
    for (const pair of SAMPLE_PAIRS.filter((p) => p.film)) {
      const film = pair.film as { src: string; poster: string };
      expect(statSync(join(PUBLIC, film.src)).size).toBeLessThan(2_000_000);
      expect(existsSync(join(ASSETS, `${film.poster}.jpg`))).toBe(true);
    }
  });
});

describe("sample films", () => {
  it("every sample film names its story and has a loop and a poster", () => {
    for (const f of SAMPLE_FILMS) {
      expect(["zombie", "christmas"], f.id).toContain(f.story);
      expect(existsSync(join(PUBLIC, filmSrc(f.id))), `${f.id} film`).toBe(true);
      expect(statSync(join(PUBLIC, filmSrc(f.id))).size, `${f.id} size`).toBeLessThan(
        f.story === "christmas" ? 4_000_000 : 2_100_000,
      );
      expect(existsSync(join(PUBLIC, filmLoop(f.id))), `${f.id} loop`).toBe(true);
      expect(statSync(join(PUBLIC, filmLoop(f.id))).size, `${f.id} loop size`).toBeLessThan(
        f.story === "christmas" ? 250_000 : 400_000,
      );
      expect(existsSync(join(ASSETS, filmPoster(f.id))), `${f.id} poster`).toBe(true);
      expect(existsSync(join(ASSETS, filmMemory(f.id))), `${f.id} memory`).toBe(true);
      expect(samplePair(f.pair), `${f.id} pair`).toBeDefined();
    }
  });

  it("samples cover every live christmas scene", () => {
    const live = Object.entries(STORIES.christmas.scenes)
      .filter(([, s]) => s.live)
      .map(([id]) => id)
      .sort();
    const shown = SAMPLE_FILMS.filter((f) => f.story === "christmas")
      .map((f) => f.scene)
      .sort();
    expect(shown).toEqual(live);
  });

  it("keeps christmas films out of the zombie scene picker", () => {
    expect(ZOMBIE_FILMS.every((f) => f.story === "zombie")).toBe(true);
    expect(ZOMBIE_FILMS.length).toBe(4);
  });
});
