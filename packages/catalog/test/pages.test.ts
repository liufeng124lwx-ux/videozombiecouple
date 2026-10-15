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
  it("give no free generation at all (owner, 2026-10-15)", () => {
    expect(QUOTA).toEqual({});
  });

  it("keep photos 1 day, work files 3 days and videos 14 days (spec §3.4)", () => {
    // Photos and keyframes: 3 days for everyone. Films: 3 days unverified, 30 days verified.
    expect(RETENTION).toMatchObject({
      inputHours: 24,
      workDays: 3,
      guestFilmDays: 3,
      memberFilmDays: 30,
    });
    expect(RETENTION).not.toHaveProperty("outputDays");
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
    // SEO review 2026-10-15: "zombie couple" and "ai zombie" are the searched words; "zombie love story" means something else on Google.
    expect(pageById("home")?.locales.en.h1).toBe("AI Zombie Couple Video");
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
      "zombie-couple-halloween",
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

  it("has a live Halloween costume post that points back to the tool (SEO review 2026-10-15)", () => {
    const post = pageById("zombie-couple-halloween");
    expect(post?.kind).toBe("blog");
    expect(post?.locales.en).toMatchObject({
      slug: "zombie-couple-halloween",
      status: "live",
      h1: "Zombie Couple Halloween Ideas",
    });
    expect(post?.related).toContain("home");
  });
});
