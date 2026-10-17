import { ES_H1 } from "./locales/es.ts";
import { FR_H1 } from "./locales/fr.ts";
import { PT_H1 } from "./locales/pt.ts";
import { STORIES } from "./stories/index.ts";
import type { Story, StoryId } from "./stories/types.ts";
import type { Kind } from "./story.ts";

/** English first (x-default). Spanish, Portuguese and French since 2026-10-17: GPT sends them. */
export const LOCALE_IDS = ["en", "es", "pt", "fr"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export type PageKind =
  | "home"
  | "landing"
  | "photo"
  | "story"
  | "pricing"
  | "blog"
  | "legal"
  | "account";

export type PageLocale = { slug: string; status: "live" | "draft"; h1: string; liveSince?: string };

/** Spec §6: one row per page; production builds only emit live pages. */
export type PageConfig = {
  id: string;
  kind: PageKind;
  /** Landing pages open the tool with these presets (story absent: the zombie film). */
  preset?: { story?: StoryId; kind?: Kind; scene?: string };
  noindex?: boolean;
  locales: Partial<Record<LocaleId, PageLocale>> & { en: PageLocale };
  related: readonly string[];
};

/**
 * Pages translated into every locale: the ones people land on, and the tool's own pages so a
 * visitor stays in their language. Legal pages stay English (the English text is the binding one).
 */
export const TRANSLATED_PAGES = [
  "home",
  "zombie-love-story-ai",
  "pet-zombie-video",
  "ai-christmas-video",
  "ai-zombie-filter",
  "zombie-couple-halloween",
  "pricing",
  "story",
  "account",
] as const;

const H1S: Record<Exclude<LocaleId, "en">, Record<string, string>> = {
  es: ES_H1,
  pt: PT_H1,
  fr: FR_H1,
};

/** The translations of a page with the English slug: live where its English page is live. */
function translations(id: string, en: PageLocale): Partial<Record<LocaleId, PageLocale>> {
  if (!(TRANSLATED_PAGES as readonly string[]).includes(id)) return {};
  return Object.fromEntries(
    Object.entries(H1S).map(([locale, h1s]) => {
      const h1 = h1s[id];
      if (!h1) throw new Error(`page ${id} has no ${locale} H1`);
      return [locale, { slug: en.slug, status: en.status, h1 }];
    }),
  );
}

const page = (
  id: string,
  kind: PageKind,
  slug: string,
  h1: string,
  status: "live" | "draft",
  related: string[],
  preset?: PageConfig["preset"],
): PageConfig => ({
  id,
  kind,
  ...(preset ? { preset } : {}),
  locales: { en: { slug, status, h1 }, ...translations(id, { slug, status, h1 }) },
  related,
});

const legal = (id: string, slug: string, h1: string): PageConfig => ({
  id,
  kind: "legal",
  noindex: true,
  locales: { en: { slug, status: "live", h1 } },
  related: [],
});

/** Spec §6 and §9: phase one ships home, the love-story page and pricing; phase two the rest. */
export const PAGES: readonly PageConfig[] = [
  // Showcase spec §4 (owner, 2026-10-16): the home page shows every story, so its H1 names none.
  page("home", "home", "", "AI couple videos from your photos", "live", [
    "ai-christmas-video",
    "zombie-love-story-ai",
    "pet-zombie-video",
  ]),
  page("zombie-love-story-ai", "landing", "zombie-love-story-ai", "Zombie Love Story AI", "live", [
    "home",
    "zombie-love-story-prompts",
  ]),
  page(
    "pet-zombie-video",
    "landing",
    "pet-zombie-video",
    "Pet Zombie Video",
    "live",
    ["home", "zombie-love-story-ai"],
    { kind: "pet" },
  ),
  // Showcase spec §5: the Christmas film's own page; launched with the tool open (no "opening soon").
  page(
    "ai-christmas-video",
    "landing",
    "ai-christmas-video",
    "AI Christmas Video",
    "live",
    ["home", "zombie-love-story-ai"],
    { story: "christmas" },
  ),
  page(
    "zombie-love-story-prompts",
    "blog",
    "zombie-love-story-prompts",
    "Zombie Love Story Prompts",
    "draft",
    ["home", "zombie-love-story-ai"],
  ),
  page(
    "zombie-couple-halloween",
    "blog",
    "zombie-couple-halloween",
    "Zombie Couple Halloween Ideas",
    "live",
    ["home", "zombie-love-story-ai", "pet-zombie-video"],
  ),
  page("ai-zombie-filter", "photo", "ai-zombie-filter", "AI Zombie Filter", "live", [
    "home",
    "pet-zombie-video",
    "zombie-couple-halloween",
  ]),
  page("pricing", "pricing", "pricing", "Pricing", "live", []),
  { ...page("story", "story", "story", "Your Zombie Love Story", "live", []), noindex: true },
  { ...page("account", "account", "account", "Account", "live", []), noindex: true },
  legal("privacy", "privacy", "Privacy Policy"),
  legal("terms", "terms", "Terms of Service"),
  legal("refund", "refund", "Refund Policy"),
  legal("dmca", "dmca", "DMCA Policy"),
  {
    id: "about",
    kind: "legal",
    locales: { en: { slug: "about", status: "live", h1: "About VideoZombieCouple" } },
    related: [],
  },
  {
    id: "contact",
    kind: "legal",
    locales: { en: { slug: "contact", status: "live", h1: "Contact" } },
    related: [],
  },
];

export function pageById(id: string, pages: readonly PageConfig[] = PAGES): PageConfig | undefined {
  return pages.find((page) => page.id === id);
}

export function isLive(page: PageConfig, locale: LocaleId = "en"): boolean {
  return page.locales[locale]?.status === "live";
}

/** Related tools shown on a page: never link to a draft (spec 2.1). */
export function liveRelated(
  page: PageConfig,
  locale: LocaleId = "en",
  pages: readonly PageConfig[] = PAGES,
): PageConfig[] {
  return page.related
    .map((id) => pageById(id, pages))
    .filter((p): p is PageConfig => p !== undefined && isLive(p, locale));
}

/** Canonical path, no trailing slash (spec 2.4). */
export function pagePath(page: PageConfig, locale: LocaleId = "en"): string {
  const entry = page.locales[locale];
  if (!entry) throw new Error(`page ${page.id} has no ${locale} locale`);
  const prefix = locale === "en" ? "" : `/${locale}`;
  if (entry.slug === "") return prefix || "/";
  return `${prefix}/${entry.slug}`;
}

/** Where to link a page from a page in `locale`: its translation if live, else the English page. */
export function localizedPath(page: PageConfig, locale: LocaleId): string {
  return pagePath(page, isLive(page, locale) ? locale : "en");
}

/** Spec 2.1: production builds emit live locales only; preview (staging, local) emits all, noindexed. */
export type BuildMode = "production" | "preview";

export type PageEntry = { page: PageConfig; locale: LocaleId; path: string; draft: boolean };

export const LOCALE_NAMES: Record<LocaleId, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  fr: "Français",
};

export function builtLocales(page: PageConfig, mode: BuildMode): LocaleId[] {
  return LOCALE_IDS.filter((locale) => {
    const entry = page.locales[locale];
    return entry !== undefined && (mode === "preview" || entry.status === "live");
  });
}

/** Every page a build emits, page by page in catalog order, locales in LOCALE_IDS order. */
export function pageEntries(mode: BuildMode, pages: readonly PageConfig[] = PAGES): PageEntry[] {
  return pages.flatMap((page) =>
    builtLocales(page, mode).map((locale) => ({
      page,
      locale,
      path: pagePath(page, locale),
      draft: !isLive(page, locale),
    })),
  );
}

/** Spec 2.4: only live pages of a production build, and never legal / account pages. */
export function indexable(entry: PageEntry, mode: BuildMode): boolean {
  return mode === "production" && !entry.draft && entry.page.noindex !== true;
}

export function hreflangOf(locale: LocaleId): string {
  return locale;
}

/** Spec 2.3: each built locale of the page, plus x-default on English. */
export function alternates(
  page: PageConfig,
  mode: BuildMode,
): { hreflang: string; path: string }[] {
  const locales = builtLocales(page, mode);
  const links = locales.map((locale) => ({
    hreflang: hreflangOf(locale),
    path: pagePath(page, locale),
  }));
  return locales.includes("en")
    ? [{ hreflang: "x-default", path: pagePath(page, "en") }, ...links]
    : links;
}

/** Showcase spec §4: the story the home page's first screen features between two dates (UTC days). */
export type FeaturedWindow = { story: StoryId; from: string; until: string };

/**
 * The site is built statically: the home page and every "make a film" link change at the first
 * build on or after `from` (and after `until`). Rebuild and deploy the site on 2026-11-01 and on
 * 2026-12-27, or the old story stays featured.
 */
export const FEATURED: readonly FeaturedWindow[] = [
  { story: "christmas", from: "2026-11-01", until: "2026-12-26" },
];

/** Featured when no window is open. */
export const DEFAULT_FEATURED: StoryId = "zombie";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The featured story at `now` (ms): an open window's story if it has a live scene, else the zombie film. */
export function featuredStory(
  now: number,
  windows: readonly FeaturedWindow[] = FEATURED,
  stories: Readonly<Record<StoryId, Story>> = STORIES,
): StoryId {
  const open = windows.find(
    (w) =>
      now >= Date.parse(`${w.from}T00:00:00Z`) &&
      now < Date.parse(`${w.until}T00:00:00Z`) + DAY_MS &&
      Object.values(stories[w.story].scenes).some((scene) => scene.live),
  );
  return open?.story ?? DEFAULT_FEATURED;
}

/** A story's own live page: the landing page whose tool is preset to it (and to the pet version). */
export function storyPage(
  story: StoryId,
  kind: "human" | "pet" = "human",
  locale: LocaleId = "en",
  pages: readonly PageConfig[] = PAGES,
): PageConfig | undefined {
  return pages.find(
    (p) =>
      p.kind === "landing" &&
      isLive(p, locale) &&
      (p.preset?.story ?? "zombie") === story &&
      (p.preset?.kind ?? "human") === kind,
  );
}

/** Where every "make a film" link goes (showcase spec §5a): the featured story's page. */
export function makeHref(now: number, locale: LocaleId = "en"): string {
  const page = storyPage(featuredStory(now), "human", locale) ?? storyPage(DEFAULT_FEATURED);
  if (!page) throw new Error("no live story page to make a film on");
  return localizedPath(page, locale);
}
