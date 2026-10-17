import type { PageConfig } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { companyLinks, storyLinks } from "./nav.ts";

const page = (id: string, status: "live" | "draft", h1: string): PageConfig => ({
  id,
  kind: id === "home" ? "home" : "landing",
  locales: { en: { slug: id === "home" ? "" : id, status, h1 } },
  related: [],
});

const PAGES_UNDER_TEST = [
  page("home", "live", "Zombie Video Couple"),
  page("zombie-love-story-ai", "live", "Zombie Love Story AI"),
  page("pet-zombie-video", "draft", "Pet Zombie Video"),
  page("pricing", "live", "Pricing"),
  page("privacy", "live", "Privacy Policy"),
];

describe("nav", () => {
  it("links only live story pages, in order", () => {
    expect(storyLinks("en", PAGES_UNDER_TEST)).toEqual([
      { label: "Zombie Video Couple", href: "/" },
      { label: "Zombie Love Story AI", href: "/zombie-love-story-ai" },
    ]);
  });
  it("links the Christmas film's page from every footer (showcase spec §2: indexed before December)", () => {
    expect(storyLinks("en").map((l) => l.href)).toContain("/ai-christmas-video");
  });
  it("links live company pages", () => {
    expect(companyLinks("en", PAGES_UNDER_TEST).map((l) => l.href)).toEqual([
      "/pricing",
      "/privacy",
    ]);
  });
  it("on a translated page, links translations and falls back to English pages", () => {
    const es = storyLinks("es");
    expect(es.map((l) => l.href)).toContain("/es/ai-christmas-video");
    expect(es.every((l) => l.href.startsWith("/es"))).toBe(true);
    const company = companyLinks("es").map((l) => l.href);
    expect(company).toContain("/es/pricing");
    expect(company).toContain("/privacy");
  });
});
