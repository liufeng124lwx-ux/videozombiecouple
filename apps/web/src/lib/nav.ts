import { isLive, type LocaleId, PAGES, type PageConfig, pagePath } from "@vzc/catalog";

export type NavLink = { label: string; href: string };

const STORIES = [
  "home",
  "zombie-love-story-ai",
  "pet-zombie-video",
  "ai-zombie-filter",
  "zombie-couple-halloween",
  "zombie-love-story-prompts",
];
const COMPANY = ["pricing", "about", "contact", "privacy", "terms", "refund", "dmca"];

const link = (page: PageConfig, locale: LocaleId): NavLink => ({
  label: page.locales[locale]?.h1 ?? page.id,
  href: pagePath(page, locale),
});

function liveLinks(ids: string[], locale: LocaleId, pages: readonly PageConfig[]): NavLink[] {
  return ids.flatMap((id) => {
    const page = pages.find((p) => p.id === id);
    return page && isLive(page, locale) ? [link(page, locale)] : [];
  });
}

/** Footer "Make one" column: the live story pages, in catalog order. */
export function storyLinks(locale: LocaleId, pages: readonly PageConfig[] = PAGES): NavLink[] {
  return liveLinks(STORIES, locale, pages);
}

export function companyLinks(locale: LocaleId, pages: readonly PageConfig[] = PAGES): NavLink[] {
  return liveLinks(COMPANY, locale, pages);
}
