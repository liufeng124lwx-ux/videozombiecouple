import { isLive, type LocaleId, localizedPath, PAGES, type PageConfig } from "@vzc/catalog";

export type NavLink = { label: string; href: string };

const STORIES = [
  "home",
  "ai-christmas-video",
  "zombie-love-story-ai",
  "pet-zombie-video",
  "ai-zombie-filter",
  "zombie-couple-halloween",
  "zombie-love-story-prompts",
];
const COMPANY = ["pricing", "about", "contact", "privacy", "terms", "refund", "dmca"];

/** A page without a translation links to the English page, under its English name. */
export const pageLink = (page: PageConfig, locale: LocaleId): NavLink => ({
  label: (isLive(page, locale) ? page.locales[locale]?.h1 : page.locales.en.h1) ?? page.id,
  href: localizedPath(page, locale),
});

function liveLinks(ids: string[], locale: LocaleId, pages: readonly PageConfig[]): NavLink[] {
  return ids.flatMap((id) => {
    const page = pages.find((p) => p.id === id);
    return page && isLive(page, "en") ? [pageLink(page, locale)] : [];
  });
}

/** Footer "Make one" column: the live story pages, in catalog order. */
export function storyLinks(locale: LocaleId, pages: readonly PageConfig[] = PAGES): NavLink[] {
  return liveLinks(STORIES, locale, pages);
}

export function companyLinks(locale: LocaleId, pages: readonly PageConfig[] = PAGES): NavLink[] {
  return liveLinks(COMPANY, locale, pages);
}
