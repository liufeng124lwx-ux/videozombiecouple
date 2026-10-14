import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HERO_PAIR, SAMPLE_PAIRS, sampleAlt, sampleFile } from "./samples.ts";

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
