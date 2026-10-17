import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fact, makeHref, pageById } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { homeHero, WALL_GROUPS, wallTiles } from "../lib/home.ts";
import { llmsTxt } from "../lib/llms.ts";
import { handWrittenNumbers } from "../lib/numbers.ts";

const src = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(src, path), "utf8");
const template = read("templates/HomePage.astro");
const markup = template.split("---").slice(2).join("---");
const mdx = read("content/pages/en/home.mdx");
const at = (day: string) => Date.parse(`${day}T12:00:00Z`);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("home page (showcase spec §4)", () => {
  it("has the H1 for every story", () => {
    expect(pageById("home")?.locales.en.h1).toBe("AI couple videos from your photos");
    expect(markup).toMatch(/<h1[^>]*>\{h1\}<\/h1>/);
  });

  it("opens on the featured story's film, with one button to that story's page", () => {
    const xmas = homeHero(at("2026-11-15"));
    expect(xmas.story).toBe("christmas");
    expect(xmas.href).toBe("/ai-christmas-video");
    expect(xmas.film.story).toBe("christmas");
    expect(xmas.eyebrow).toMatch(/Christmas/);
    expect(xmas.cta).toMatch(/Christmas/);
    expect(xmas.subtitle).toContain(fact("story.christmas.years"));

    const zombie = homeHero(at("2026-10-16"));
    expect(zombie.story).toBe("zombie");
    expect(zombie.href).toBe("/zombie-love-story-ai");
    expect(zombie.film.story).toBe("zombie");
    expect(zombie.eyebrow).not.toMatch(/Christmas/);
    expect(zombie.cta).toMatch(/zombie/i);

    expect(markup).toMatch(/href=\{hero\.href\}/);
    // One build-time hero for the preload and the page, so they can't disagree.
    expect(template).toMatch(/homeHero\(BUILD_NOW\)/);
    expect(read("pages/[...path].astro")).toMatch(/homeHero\(BUILD_NOW\)/);
    expect(template).not.toMatch(/Date\.now\(\)/);
    expect(read("pages/[...path].astro")).not.toMatch(/Date\.now\(\)/);
  });

  it("has no upload tool: a visitor picks a story first", () => {
    expect(template).not.toMatch(/StoryTool/);
    expect(markup).not.toMatch(/id="make"/);
    expect(markup).not.toMatch(/href="#make"/);
  });

  it("shows one wall tile per live story × scene, each linking to its story's page", () => {
    const tiles = wallTiles();
    const count = (group: string) => tiles.filter((t) => t.group === group).length;
    expect(count("christmas")).toBe(2);
    expect(count("zombie")).toBe(3);
    expect(count("pet")).toBe(1);
    expect(tiles).toHaveLength(6);
    expect(WALL_GROUPS).toEqual(["christmas", "zombie", "pet"]);
    for (const tile of tiles) {
      expect(tile.href).toBe(
        {
          christmas: "/ai-christmas-video",
          zombie: "/zombie-love-story-ai",
          pet: "/pet-zombie-video",
        }[tile.group],
      );
      expect(tile.alt).toMatch(/^AI example: /);
      expect(tile.loop).toMatch(/-loop\.mp4$/);
    }
    // Captions carry scene words (long tail): "Christmas · Snowy cabin".
    expect(tiles.map((t) => t.caption)).toContain("Christmas · Snowy cabin");
    expect(markup).toMatch(/<FilmWall client:visible tiles=\{wall\}/);
  });

  it("keeps how it works, pricing and the FAQ; the pack band returns to /pricing", () => {
    expect(markup).toMatch(/d\.steps/);
    // A sign-in comes back as /pricing?buy=<pack>: the pricing page continues the purchase
    // (landing pages only mount pack rows in the tool's pay phase and would drop ?buy=).
    expect(markup).toMatch(/<PackRows client:visible returnPath="\/pricing"/);
    expect(markup).toMatch(/d\.faq/);
  });

  it("takes every number from the catalog", () => {
    expect(markup.replace(/fact\("[^"]+"\)/g, "")).not.toMatch(
      /\$\d|\b\d+ (videos|days|seconds|minutes|credits)\b/,
    );
    expect(handWrittenNumbers(mdx)).toEqual([]);
  });

  it("says how long each film takes from the catalog, never 'a few minutes'", () => {
    expect(mdx).not.toMatch(/a few minutes/);
    expect(mdx).toContain("{{story.zombie.minutes}}");
    expect(mdx).toContain("{{story.christmas.minutes}}");
  });
});

describe("'make a film' links (showcase spec §5a)", () => {
  it("go to the featured story's page, never to the home page's old tool", () => {
    const left = files(src).filter(
      (f) => f !== import.meta.filename && readFileSync(f, "utf8").includes("/#make"),
    );
    expect(left).toEqual([]);
    expect(read("components/layout/Header.astro")).toMatch(/href=\{makeHref\(/);
    // The photo filter's upsell describes the zombie film: always the zombie page.
    for (const file of ["components/photo/PhotoTool.tsx", "templates/PhotoPage.astro"]) {
      expect(read(file)).not.toMatch(/makeHref/);
      expect(read(file)).toMatch(/storyPage\("zombie"\)/);
    }
    expect(read("templates/BlogPage.astro")).toMatch(/makeHref\(/);
    expect(makeHref(at("2026-11-15"))).toBe("/ai-christmas-video");
  });
});

describe("llms.txt", () => {
  it("names the Christmas film, its price and each film's wait from the catalog", () => {
    const text = llmsTxt("https://videozombiecouple.com");
    expect(text).toContain("https://videozombiecouple.com/ai-christmas-video");
    expect(text).toContain(fact("story.christmas.usd"));
    expect(text).toContain(`${fact("story.christmas.seconds")}-second`);
    expect(text).toContain(`about ${fact("story.zombie.minutes")} minutes`);
    expect(text).toContain(`about ${fact("story.christmas.minutes")} minutes`);
    expect(text).not.toMatch(/a few minutes/);
  });
});
