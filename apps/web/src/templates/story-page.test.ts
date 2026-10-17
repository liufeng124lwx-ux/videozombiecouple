import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "StoryPage.astro"), "utf8");

describe("StoryPage (/story?id=)", () => {
  it("gives the tool posters for every story's live scenes, not just the zombie film's", () => {
    expect(source).toMatch(/pickerFilms\(\)/);
    expect(source).not.toMatch(/ZOMBIE_FILMS/);
  });
});
