import { describe, expect, it } from "vitest";
import { FEATURED, featuredStory, makeHref, pageById, STORIES, storyPage } from "../src/index.ts";

const at = (day: string) => Date.parse(`${day}T12:00:00Z`);

describe("featured story (showcase spec §4)", () => {
  it("features Christmas from 2026-11-01 until 2026-12-26, the zombie film otherwise", () => {
    expect(FEATURED).toEqual([{ story: "christmas", from: "2026-11-01", until: "2026-12-26" }]);
    expect(featuredStory(at("2026-11-15"))).toBe("christmas");
    expect(featuredStory(at("2026-11-01"))).toBe("christmas");
    expect(featuredStory(at("2026-10-20"))).toBe("zombie");
    expect(featuredStory(at("2026-12-27"))).toBe("zombie");
  });

  it("only features a story with a live scene", () => {
    const closed = { ...STORIES, christmas: { ...STORIES.christmas, scenes: {} } };
    expect(featuredStory(at("2026-11-15"), FEATURED, closed)).toBe("zombie");
  });

  it("finds each story's own page", () => {
    expect(storyPage("christmas")?.id).toBe("ai-christmas-video");
    expect(storyPage("zombie")?.id).toBe("zombie-love-story-ai");
    expect(storyPage("zombie", "pet")?.id).toBe("pet-zombie-video");
  });

  it("sends 'make a film' links to the featured story's page", () => {
    expect(makeHref(at("2026-11-15"))).toBe("/ai-christmas-video");
    expect(makeHref(at("2026-10-16"))).toBe("/zombie-love-story-ai");
    expect(makeHref(at("2026-12-27"))).toBe("/zombie-love-story-ai");
  });

  it("titles the home page for every story, not one", () => {
    expect(pageById("home")?.locales.en.h1).toBe("AI couple videos from your photos");
  });
});
