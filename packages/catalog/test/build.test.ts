import { describe, expect, it } from "vitest";
import {
  alternates,
  builtLocales,
  hreflangOf,
  indexable,
  LOCALE_IDS,
  LOCALE_NAMES,
  navGroup,
  type PageConfig,
  pageEntries,
} from "../src/index.ts";

const live = (slug: string) => ({ slug, status: "live" as const, h1: "H" });
const draft = (slug: string) => ({ slug, status: "draft" as const, h1: "H" });
const page = (id: string, locales: PageConfig["locales"], extra: Partial<PageConfig> = {}) =>
  ({ id, kind: "ai-tool", engine: "unblur", locales, related: [], ...extra }) as PageConfig;

const PAGES_UNDER_TEST: PageConfig[] = [
  page("home", { en: live(""), es: draft("") }, { kind: "home" }),
  page("tool-a", { en: live("tool-a"), es: live("herramienta-a") }),
  page("tool-b", { en: draft("tool-b") }),
  page("terms", { en: live("terms") }, { kind: "legal", engine: undefined, noindex: true }),
];
const [home, toolA, toolB, terms] = PAGES_UNDER_TEST as [
  PageConfig,
  PageConfig,
  PageConfig,
  PageConfig,
];

describe("build modes (spec 2.1)", () => {
  it("emit live locales only in production", () => {
    expect(pageEntries("production", PAGES_UNDER_TEST).map((e) => e.path)).toEqual([
      "/",
      "/tool-a",
      "/es/herramienta-a",
      "/terms",
    ]);
    expect(builtLocales(toolB, "production")).toEqual([]);
  });

  it("emit drafts too in preview, marked as drafts", () => {
    expect(pageEntries("preview", PAGES_UNDER_TEST).map((e) => [e.path, e.draft])).toEqual([
      ["/", false],
      ["/es", true],
      ["/tool-a", false],
      ["/es/herramienta-a", false],
      ["/tool-b", true],
      ["/terms", false],
    ]);
  });

  it("let search engines index live, indexable pages of a production build only", () => {
    const flags = pageEntries("production", PAGES_UNDER_TEST).map((e) => [
      e.path,
      indexable(e, "production"),
    ]);
    expect(flags).toEqual([
      ["/", true],
      ["/tool-a", true],
      ["/es/herramienta-a", true],
      ["/terms", false],
    ]);
    for (const entry of pageEntries("preview", PAGES_UNDER_TEST))
      expect(indexable(entry, "preview")).toBe(false);
  });
});

describe("hreflang (spec 2.3)", () => {
  it("links every built locale of a page, with x-default on English", () => {
    expect(alternates(toolA, "production")).toEqual([
      { hreflang: "x-default", path: "/tool-a" },
      { hreflang: "en", path: "/tool-a" },
      { hreflang: "es", path: "/es/herramienta-a" },
    ]);
    expect(alternates(home, "production")).toEqual([
      { hreflang: "x-default", path: "/" },
      { hreflang: "en", path: "/" },
    ]);
    expect(alternates(home, "preview")).toContainEqual({ hreflang: "es", path: "/es" });
  });

  it("writes Brazilian Portuguese as pt-BR", () => {
    expect(hreflangOf("pt-br")).toBe("pt-BR");
    expect(hreflangOf("ja")).toBe("ja");
  });

  it("names every locale in its own language", () => {
    for (const locale of LOCALE_IDS) expect(LOCALE_NAMES[locale]).toBeTruthy();
    expect(LOCALE_NAMES.en).toBe("English");
  });
});

describe("navigation groups (spec 2.4)", () => {
  it("puts AI image tools under Image and browser tools under Free Tools", () => {
    expect(navGroup(home)).toBe("image");
    expect(navGroup(toolA)).toBe("image");
    expect(navGroup({ ...toolA, kind: "local-tool", engine: undefined })).toBe("free");
    expect(navGroup(terms)).toBeNull();
  });
});
