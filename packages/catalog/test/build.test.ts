import { describe, expect, it } from "vitest";
import { alternates, indexable, type PageConfig, pageEntries } from "../src/index.ts";

const live = (slug: string) => ({ slug, status: "live" as const, h1: "H" });
const draft = (slug: string) => ({ slug, status: "draft" as const, h1: "H" });
const page = (id: string, en: PageConfig["locales"]["en"], extra: Partial<PageConfig> = {}) =>
  ({ id, kind: "landing", locales: { en }, related: [], ...extra }) as PageConfig;

const PAGES_UNDER_TEST: PageConfig[] = [
  page("home", live(""), { kind: "home" }),
  page("landing-a", live("landing-a")),
  page("landing-b", draft("landing-b")),
  page("terms", live("terms"), { kind: "legal", noindex: true }),
];

describe("build modes (spec §6)", () => {
  it("emit live pages only in production", () => {
    expect(pageEntries("production", PAGES_UNDER_TEST).map((e) => e.path)).toEqual([
      "/",
      "/landing-a",
      "/terms",
    ]);
  });

  it("emit drafts too in preview, marked as drafts", () => {
    const entries = pageEntries("preview", PAGES_UNDER_TEST);
    expect(entries.find((e) => e.path === "/landing-b")?.draft).toBe(true);
  });

  it("let search engines index live, indexable pages of a production build only", () => {
    const prod = pageEntries("production", PAGES_UNDER_TEST);
    expect(prod.filter((e) => indexable(e, "production")).map((e) => e.path)).toEqual([
      "/",
      "/landing-a",
    ]);
    expect(pageEntries("preview", PAGES_UNDER_TEST).some((e) => indexable(e, "preview"))).toBe(
      false,
    );
  });

  it("links English with x-default", () => {
    expect(alternates(PAGES_UNDER_TEST[1] as PageConfig, "production")).toEqual([
      { hreflang: "x-default", path: "/landing-a" },
      { hreflang: "en", path: "/landing-a" },
    ]);
  });
});
