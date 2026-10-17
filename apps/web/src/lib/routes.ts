import { type BuildMode, type LocaleId, PAGES, type PageConfig, pageEntries } from "@vzc/catalog";
import { hasMessages } from "@vzc/i18n";
// Build-time module: every locale's strings, so staticPaths can check them.
import "@vzc/i18n/all";

export type RouteProps = { pageId: string; locale: LocaleId; draft: boolean };

/** getStaticPaths for `[...path].astro`; the home page's rest param is undefined. */
export function staticPaths(mode: BuildMode, pages: readonly PageConfig[] = PAGES) {
  return pageEntries(mode, pages).map((entry) => {
    if (!hasMessages(entry.locale))
      throw new Error(`No UI messages for ${entry.locale} (page ${entry.page.id})`);
    const props: RouteProps = { pageId: entry.page.id, locale: entry.locale, draft: entry.draft };
    return { params: { path: entry.path === "/" ? undefined : entry.path.slice(1) }, props };
  });
}
