import type { EditorPageId } from "./editor.ts";
import type { ModeId } from "./modes.ts";
import type { ImageToolId } from "./tools.ts";

export const LOCALE_IDS = ["en", "es", "ja", "pt-br", "ru", "id", "fr", "de"] as const;
export type LocaleId = (typeof LOCALE_IDS)[number];

export type PageKind =
  | "home"
  | "ai-tool"
  | "local-tool"
  | "editor"
  | "pricing"
  | "blog"
  | "legal"
  | "account";

export type PageLocale = { slug: string; status: "live" | "draft"; h1: string; liveSince?: string };

/** Spec 2.1: one row per page; production builds only emit live locales. */
export type PageConfig = {
  id: string;
  kind: PageKind;
  engine?: "unblur";
  defaultMode?: ModeId;
  modes?: readonly ModeId[];
  noindex?: boolean;
  locales: Partial<Record<LocaleId, PageLocale>> & { en: PageLocale };
  related: readonly string[];
  /** Local tools spec 1.2: which IMAGE_TOOLS preset a local-tool page runs (not Compress GIF). */
  tool?: ImageToolId;
  /** Editor spec 3.4: which EDITOR_PAGES preset an editor page opens with. */
  editor?: EditorPageId;
};

const UNBLUR_MODES: readonly ModeId[] = ["auto", "motion", "focus", "portrait", "text", "old"];

const tool = (
  id: string,
  h1: string,
  defaultMode: ModeId,
  related: string[],
  status: "live" | "draft" = "draft",
): PageConfig => ({
  id,
  kind: id === "home" ? "home" : "ai-tool",
  engine: "unblur",
  defaultMode,
  modes: UNBLUR_MODES,
  locales: { en: { slug: id === "home" ? "" : id, status, h1 } },
  related,
});

const legal = (id: string, slug: string, h1: string): PageConfig => ({
  id,
  kind: "legal",
  noindex: true,
  locales: { en: { slug, status: "live", h1 } },
  related: [],
});

export const PAGES: readonly PageConfig[] = [
  tool(
    "home",
    "Unblur Image",
    "auto",
    ["unblur-photo", "fix-blurry-photo", "make-image-clearer", "compress-gif"],
    "live",
  ),
  tool("unblur-photo", "Unblur Photo", "portrait", [
    "home",
    "fix-blurry-photo",
    "make-image-clearer",
  ]),
  tool("fix-blurry-photo", "Fix Blurry Photo", "auto", [
    "home",
    "unblur-photo",
    "make-image-clearer",
  ]),
  tool("make-image-clearer", "Make Image Clearer", "auto", [
    "home",
    "unblur-photo",
    "fix-blurry-photo",
  ]),
  {
    id: "compress-gif",
    kind: "local-tool",
    locales: { en: { slug: "compress-gif", status: "draft", h1: "Compress GIF" } },
    related: ["home"],
  },
  {
    id: "heic-to-jpg",
    kind: "local-tool",
    tool: "heic-to-jpg",
    locales: { en: { slug: "heic-to-jpg", status: "draft", h1: "HEIC to JPG" } },
    related: ["home", "compress-gif"],
  },
  {
    id: "color-picker-from-image",
    kind: "editor",
    editor: "color-picker-from-image",
    locales: {
      en: { slug: "color-picker-from-image", status: "draft", h1: "Color Picker from Image" },
    },
    related: ["home", "heic-to-jpg"],
  },
  {
    id: "how-to-unblur-a-picture",
    kind: "blog",
    locales: {
      en: { slug: "blog/how-to-unblur-a-picture", status: "draft", h1: "How to Unblur a Picture" },
    },
    related: ["home", "fix-blurry-photo"],
  },
  {
    id: "pricing",
    kind: "pricing",
    locales: { en: { slug: "pricing", status: "live", h1: "Pricing" } },
    related: [],
  },
  {
    id: "account",
    kind: "account",
    noindex: true,
    locales: { en: { slug: "account", status: "live", h1: "Account" } },
    related: [],
  },
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

export const LOCALE_NAMES: Record<LocaleId, string> = {
  en: "English",
  es: "Español",
  ja: "日本語",
  "pt-br": "Português (Brasil)",
  ru: "Русский",
  id: "Bahasa Indonesia",
  fr: "Français",
  de: "Deutsch",
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
  return locale === "pt-br" ? "pt-BR" : locale;
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

/** Spec 2.4: the Tools menu groups. */
export function navGroup(page: PageConfig): "image" | "video" | "free" | null {
  if (page.kind === "local-tool") return "free";
  if ((page.kind === "home" || page.kind === "ai-tool") && page.engine === "unblur") return "image";
  return null;
}
