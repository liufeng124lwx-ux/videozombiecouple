import { describe, expect, it } from "vitest";
import {
  ABUSE,
  FILE_LIMITS,
  isLive,
  liveRelated,
  PAGES,
  type PageConfig,
  pageById,
  pagePath,
  QUOTA,
  RETENTION,
} from "../src/index.ts";

describe("limits", () => {
  it("give logged-in users 3 free previews a day (spec §7)", () => {
    expect(QUOTA).toEqual({ previewUserDaily: 3, previewIpSegmentDaily: 10 });
  });

  it("keep photos 1 day, work files 3 days and videos 14 days (spec §3.4)", () => {
    expect(RETENTION).toMatchObject({ inputHours: 24, workDays: 3, outputDays: 14 });
  });

  it("need faces big enough to recognise", () => {
    expect(FILE_LIMITS.minShortEdge).toBe(384);
  });

  it("keep the abuse rules", () => {
    expect(ABUSE.maxRejections).toBe(5);
  });
});

describe("pages", () => {
  it("have unique ids and unique slugs", () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.locales.en.slug)).size).toBe(PAGES.length);
  });

  it("use lowercase url slugs without a trailing slash; only home is empty", () => {
    for (const p of PAGES) {
      const slug = p.locales.en.slug;
      if (p.id === "home") expect(slug).toBe("");
      else expect(slug).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    }
  });

  it("link only to pages that exist, never to themselves", () => {
    for (const p of PAGES)
      for (const id of p.related) {
        expect(pageById(id)).toBeDefined();
        expect(id).not.toBe(p.id);
      }
  });

  it("set the H1 to the page's core keyword (spec §6)", () => {
    expect(pageById("home")?.locales.en.h1).toBe("Zombie Video Couple");
    expect(pageById("zombie-love-story-ai")?.locales.en.h1).toBe("Zombie Love Story AI");
  });

  it("noindex legal, story and account pages", () => {
    for (const id of ["privacy", "terms", "refund", "dmca", "story", "account"])
      expect(pageById(id)?.noindex).toBe(true);
  });

  it("ship phase two's pet page; the prompts article stays a draft (spec §9)", () => {
    const live = PAGES.filter((p) => isLive(p) && p.kind !== "legal").map((p) => p.id);
    expect(live).toEqual([
      "home",
      "zombie-love-story-ai",
      "pet-zombie-video",
      "pricing",
      "story",
      "account",
    ]);
    expect(pageById("pet-zombie-video")?.preset).toEqual({ kind: "pet" });
  });

  it("show only live related pages", () => {
    const home = pageById("home") as PageConfig;
    expect(liveRelated(home).map((p) => p.id)).toEqual([
      "zombie-love-story-ai",
      "pet-zombie-video",
    ]);
  });

  it("build root-relative paths", () => {
    expect(pagePath(pageById("home") as PageConfig)).toBe("/");
    expect(pagePath(pageById("pricing") as PageConfig)).toBe("/pricing");
  });
});
