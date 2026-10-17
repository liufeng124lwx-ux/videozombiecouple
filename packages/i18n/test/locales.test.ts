import { LOCALE_IDS, STORIES, sceneLabel } from "@vzc/catalog";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGES } from "../src/all.ts";
import { currentLocale, en, localePath, sceneName, setLocale, t } from "../src/index.ts";

const params = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("translations (spec 2.3)", () => {
  for (const locale of LOCALE_IDS) {
    const messages = MESSAGES[locale];

    it(`${locale}: has every English key and no other`, () => {
      expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    });

    it(`${locale}: keeps every {param} of the English`, () => {
      for (const [key, value] of Object.entries(en))
        expect(params(messages[key as keyof typeof en]), key).toEqual(params(value));
    });

    it(`${locale}: never hard-codes a number (spec 2.2)`, () => {
      for (const [key, value] of Object.entries(messages))
        expect(value.replaceAll("4K", ""), key).not.toMatch(/\d/);
    });

    it(`${locale}: keeps the billing block's segments`, () => {
      expect(messages["home.billing"].split("|")).toHaveLength(
        en["home.billing"].split("|").length,
      );
    });

    it(`${locale}: keeps the cookie text short (it must not become the LCP element)`, () => {
      expect(messages["cookie.text"].length).toBeLessThanOrEqual(en["cookie.text"].length + 8);
    });
  }
});

describe("the page's locale", () => {
  afterEach(() => {
    setLocale("en");
    vi.unstubAllGlobals();
  });

  it("is English until a page sets one", () => {
    expect(currentLocale()).toBe("en");
    expect(t("nav.pricing")).toBe(en["nav.pricing"]);
  });

  it("follows the page being rendered", () => {
    setLocale("es");
    expect(currentLocale()).toBe("es");
    expect(t("nav.pricing")).toBe(MESSAGES.es["nav.pricing"]);
  });

  it("in the browser, follows the page's lang", () => {
    vi.stubGlobal("document", { documentElement: { lang: "fr" } });
    expect(currentLocale()).toBe("fr");
  });

  it("puts the tool's own paths in the page's language", () => {
    expect(localePath("/story?id=s1")).toBe("/story?id=s1");
    setLocale("pt");
    expect(localePath("/story?id=s1")).toBe("/pt/story?id=s1");
    expect(localePath("/account#stories")).toBe("/pt/account#stories");
    expect(localePath("/")).toBe("/pt");
  });

  it("names every scene in the page's language, the catalog's label in English", () => {
    for (const story of Object.values(STORIES))
      for (const id of Object.keys(story.scenes)) {
        expect(sceneName(id, "en")).toBe(sceneLabel(id));
        expect(sceneName(id, "fr"), id).toBe(MESSAGES.fr[`scene.${id}` as keyof typeof en]);
      }
  });

  it("an explicit locale wins", () => {
    setLocale("es");
    expect(t("nav.pricing", {}, "en")).toBe(en["nav.pricing"]);
  });
});
