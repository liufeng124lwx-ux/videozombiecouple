import { describe, expect, it } from "vitest";
import {
  ABUSE,
  DIAGNOSIS_THRESHOLDS,
  FREE_RETRY,
  isLive,
  LOCALE_IDS,
  liveRelated,
  MODE_IDS,
  PAGES,
  type PageConfig,
  pageById,
  pagePath,
  QUOTA,
} from "../src/index.ts";

describe("limits", () => {
  it("carry the diagnosis thresholds calibrated on the eval set (spec 3.4)", () => {
    expect(DIAGNOSIS_THRESHOLDS).toMatchObject({
      motionAnisotropy: 0.35,
      textBlockShare: 0.08,
      sepiaShare: 0.9,
      sharpnessLogOffset: 0.6,
      sharpnessLogSpan: 2.4,
    });
  });

  it("match spec 5.2 and 3.7", () => {
    expect(QUOTA).toEqual({ guestDaily: 2, userDaily: 4, ipSegmentDaily: 10 });
    expect(FREE_RETRY.perJob).toBe(1);
    expect(FREE_RETRY.perIdentityDaily).toBe(3);
    expect(FREE_RETRY.rateMinJobs).toBeLessThanOrEqual(FREE_RETRY.rateWindow);
  });

  it("match the abuse rules in spec 5.4 and 7.3", () => {
    expect(ABUSE).toEqual({
      bonusOncePerMs: 30 * 86_400_000,
      rejectionWindowMs: 86_400_000,
      maxRejections: 5,
      suspiciousDeviceMs: 30 * 86_400_000,
    });
  });
});

describe("pages", () => {
  it("have unique ids and unique slugs per locale", () => {
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
    for (const locale of LOCALE_IDS) {
      const slugs = PAGES.flatMap((p) => {
        const entry = p.locales[locale];
        return entry ? [entry.slug] : [];
      });
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("use lowercase url slugs without a trailing slash; only home is empty", () => {
    for (const page of PAGES) {
      const slug = page.locales.en.slug;
      if (page.id === "home") expect(slug).toBe("");
      else expect(slug).toMatch(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/);
    }
  });

  it("link only to pages that exist, never to themselves", () => {
    for (const page of PAGES) {
      for (const id of page.related) {
        expect(pageById(id)).toBeDefined();
        expect(id).not.toBe(page.id);
      }
    }
  });

  it("give every tool page modes and a default mode among them", () => {
    for (const page of PAGES.filter((p) => p.engine === "unblur")) {
      expect(page.modes?.length).toBeGreaterThan(0);
      for (const mode of page.modes ?? []) expect(MODE_IDS).toContain(mode);
      expect(page.modes).toContain(page.defaultMode);
    }
  });

  it("set the H1 to the page's core keyword", () => {
    expect(pageById("home")?.locales.en.h1).toBe("Unblur Image");
    expect(pageById("fix-blurry-photo")?.locales.en.h1).toBe("Fix Blurry Photo");
  });

  it("noindex legal pages and the account page (spec 2.4)", () => {
    for (const id of ["privacy", "terms", "refund", "dmca", "account"])
      expect(pageById(id)?.noindex).toBe(true);
  });

  it("start with only home, pricing, account and legal pages live (one page at a time)", () => {
    const live = PAGES.filter((p) => isLive(p)).map((p) => p.id);
    expect(live).not.toContain("unblur-photo");
    expect(live).toContain("home");
  });

  it("show only live related pages", () => {
    const pages: PageConfig[] = [
      {
        id: "a",
        kind: "ai-tool",
        locales: { en: { slug: "a", status: "live", h1: "A" } },
        related: ["b", "c"],
      },
      {
        id: "b",
        kind: "ai-tool",
        locales: { en: { slug: "b", status: "draft", h1: "B" } },
        related: [],
      },
      {
        id: "c",
        kind: "ai-tool",
        locales: { en: { slug: "c", status: "live", h1: "C" } },
        related: [],
      },
    ];
    expect(liveRelated(pages[0] as PageConfig, "en", pages).map((p) => p.id)).toEqual(["c"]);
  });

  it("build paths with a locale prefix except for English", () => {
    const page: PageConfig = {
      id: "fix",
      kind: "ai-tool",
      locales: {
        en: { slug: "fix-blurry-photo", status: "live", h1: "Fix Blurry Photo" },
        es: { slug: "arreglar-foto-borrosa", status: "draft", h1: "Arreglar foto borrosa" },
      },
      related: [],
    };
    expect(pagePath(page)).toBe("/fix-blurry-photo");
    expect(pagePath(page, "es")).toBe("/es/arreglar-foto-borrosa");
    expect(pagePath(pageById("home") as PageConfig)).toBe("/");
  });
});
