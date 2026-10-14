import type { PageConfig } from "@vzc/catalog";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staticPaths } from "./routes.ts";

const i18n = vi.hoisted(() => ({ missing: false }));
vi.mock("@vzc/i18n", async (load) => {
  const real = await load<typeof import("@vzc/i18n")>();
  return { ...real, hasMessages: (locale: "en") => !i18n.missing && real.hasMessages(locale) };
});

const live = (slug: string) => ({ slug, status: "live" as const, h1: "H" });
const PAGES_UNDER_TEST: PageConfig[] = [
  { id: "home", kind: "home", locales: { en: live("") }, related: [] },
  { id: "pricing", kind: "pricing", locales: { en: live("pricing") }, related: [] },
  {
    id: "pet-zombie-video",
    kind: "landing",
    locales: { en: { slug: "pet-zombie-video", status: "draft", h1: "P" } },
    related: [],
  },
];

afterEach(() => {
  i18n.missing = false;
});

describe("staticPaths (spec 2.1)", () => {
  it("gives the home page an empty path and passes the page to the template", () => {
    expect(staticPaths("production", PAGES_UNDER_TEST)).toEqual([
      { params: { path: undefined }, props: { pageId: "home", locale: "en", draft: false } },
      { params: { path: "pricing" }, props: { pageId: "pricing", locale: "en", draft: false } },
    ]);
  });

  it("adds drafts in preview builds", () => {
    expect(staticPaths("preview", PAGES_UNDER_TEST).map((p) => p.params.path)).toEqual([
      undefined,
      "pricing",
      "pet-zombie-video",
    ]);
  });

  it("fails the build when a built locale has no UI messages (spec 2.3)", () => {
    i18n.missing = true;
    expect(() => staticPaths("production", PAGES_UNDER_TEST)).toThrow(
      "No UI messages for en (page home)",
    );
  });
});
