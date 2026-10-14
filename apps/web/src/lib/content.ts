import { type CollectionEntry, getEntry } from "astro:content";
import type { LocaleId, PageConfig } from "@vzc/catalog";

/** The page's MDX. A draft may have none yet; a live page without one fails the build (spec 2.2). */
export async function pageContent(
  page: PageConfig,
  locale: LocaleId,
  draft: boolean,
): Promise<CollectionEntry<"pages"> | null> {
  const entry = await getEntry("pages", `${locale}/${page.id}`);
  if (entry) return entry;
  if (draft) return null;
  throw new Error(`Missing content: apps/web/src/content/pages/${locale}/${page.id}.mdx`);
}
