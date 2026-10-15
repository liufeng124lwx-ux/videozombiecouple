import type { Kind, SceneId } from "./story.ts";

/** Spec §1.3: English only; the i18n structure stays for later. */
export const LOCALE_IDS = ["en"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export type PageKind = "home" | "landing" | "story" | "pricing" | "blog" | "legal" | "account";

export type PageLocale = { slug: string; status: "live" | "draft"; h1: string; liveSince?: string };

/** Spec §6: one row per page; production builds only emit live pages. */
export type PageConfig = {
  id: string;
  kind: PageKind;
  /** Landing pages open the tool with these presets. */
  preset?: { kind?: Kind; scene?: SceneId };
  noindex?: boolean;
  locales: Partial<Record<LocaleId, PageLocale>> & { en: PageLocale };
  related: readonly string[];
};

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
  locales: { en: { slug, status, h1 } },
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
  page("home", "home", "", "AI Zombie Couple Video", "live", [
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
  page(
    "zombie-love-story-prompts",
    "blog",
    "zombie-love-story-prompts",
    "Zombie Love Story Prompts",
    "draft",
    ["home", "zombie-love-story-ai"],
  ),
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

/** Spec 2.1: production builds emit live locales only; preview (staging, local) emits all, noindexed. */
export type BuildMode = "production" | "preview";

export type PageEntry = { page: PageConfig; locale: LocaleId; path: string; draft: boolean };

export const LOCALE_NAMES: Record<LocaleId, string> = { en: "English" };

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
