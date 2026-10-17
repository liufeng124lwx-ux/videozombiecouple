import {
  alternates,
  type BuildMode,
  fact,
  indexable,
  type LocaleId,
  PAGES,
  type PageConfig,
  type PageKind,
  pageEntries,
  type StoryId,
} from "@vzc/catalog";

export type Schema = Record<string, unknown>;
export type Faq = { q: string; a: string };
export type Step = { title: string; text: string };

const CONTEXT = "https://schema.org";
/** Pages that carry a tool: described as a web app with a free offer (the check, the free photo). */
const TOOL_KINDS: readonly PageKind[] = ["home", "landing", "photo"];
const day = (date: Date) => date.toISOString().slice(0, 10);

export function organization(origin: string): Schema {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: "VideoZombieCouple",
    legalName: "Arrayon Inc.",
    description: "AI couple films made from two photos.",
    url: `${origin}/`,
    email: "hello@videozombiecouple.com",
  };
}

export function webApplication(o: {
  name: string;
  url: string;
  description: string;
  /** The offer's price ("9.99"); "0" when absent (the tool's free photo check). */
  price?: string;
}): Schema {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: o.name,
    url: o.url,
    description: o.description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    offers: { "@type": "Offer", price: o.price ?? "0", priceCurrency: "USD" },
  };
}

export type Video = {
  name: string;
  description: string;
  contentUrl: string;
  thumbnailUrl: string;
  uploadDate: string;
  durationSec: number;
};

/** 75 → "PT1M15S" (ISO 8601). */
const isoDuration = (sec: number) =>
  `PT${sec >= 60 ? `${Math.floor(sec / 60)}M` : ""}${sec % 60 ? `${sec % 60}S` : ""}`;

/** A sample film the page shows, so search engines and AI answers can say what the film is. */
export function videoObject(v: Video): Schema {
  return {
    "@context": CONTEXT,
    "@type": "VideoObject",
    name: v.name,
    description: v.description,
    contentUrl: v.contentUrl,
    thumbnailUrl: [v.thumbnailUrl],
    uploadDate: v.uploadDate,
    duration: isoDuration(v.durationSec),
  };
}

export function howTo(name: string, steps: Step[]): Schema {
  return {
    "@context": CONTEXT,
    "@type": "HowTo",
    name,
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.text,
    })),
  };
}

export function faqPage(faq: Faq[]): Schema {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

export function breadcrumbs(items: { name: string; url: string }[]): Schema {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function article(o: {
  headline: string;
  description: string;
  url: string;
  image: string;
  published: Date;
  updated?: Date | undefined;
}): Schema {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: o.headline,
    description: o.description,
    url: o.url,
    image: o.image,
    datePublished: day(o.published),
    dateModified: day(o.updated ?? o.published),
    author: { "@type": "Organization", name: "VideoZombieCouple" },
    publisher: { "@type": "Organization", name: "Arrayon Inc." },
  };
}

export type SchemaContent = {
  description: string;
  faq?: Faq[] | undefined;
  steps?: Step[] | undefined;
  howTo?: string | undefined;
  published?: Date | undefined;
  updated?: Date | undefined;
};

export type SchemaInput = {
  kind: PageKind;
  h1: string;
  url: string;
  homeUrl: string;
  image: string;
  content: SchemaContent | null;
  /** The story a landing page's tool makes; a Christmas page offers the Christmas film's price. */
  story?: StoryId | undefined;
  /** Sample films the page shows (absolute URLs). */
  videos?: Video[] | undefined;
};

/** Spec 2.4: WebApplication, FAQPage, HowTo and BreadcrumbList; Article on blog posts. */
export function pageSchemas(input: SchemaInput): Schema[] {
  const { content } = input;
  if (!content) return [];
  const out: Schema[] = [];
  if (input.kind === "home") out.push(organization(new URL(input.homeUrl).origin));
  if (TOOL_KINDS.includes(input.kind))
    out.push(
      webApplication({
        name: input.h1,
        url: input.url,
        description: content.description,
        ...(input.story === "christmas"
          ? { price: fact("story.christmas.usd").replace("$", "") }
          : {}),
      }),
    );
  if (input.kind === "blog" && content.published)
    out.push(
      article({
        headline: input.h1,
        description: content.description,
        url: input.url,
        image: input.image,
        published: content.published,
        updated: content.updated,
      }),
    );
  if (content.steps)
    out.push(
      howTo(content.howTo ?? `How to make a ${input.h1.toLowerCase()} video`, content.steps),
    );
  if (content.faq && content.faq.length > 0) out.push(faqPage(content.faq));
  for (const v of input.videos ?? []) out.push(videoObject(v));
  if (input.kind !== "home")
    out.push(
      breadcrumbs([
        { name: "Home", url: input.homeUrl },
        { name: input.h1, url: input.url },
      ]),
    );
  return out;
}

export function alternateLinks(
  page: PageConfig,
  mode: BuildMode,
  toUrl: (path: string) => string,
): { hreflang: string; href: string }[] {
  return alternates(page, mode).map((a) => ({ hreflang: a.hreflang, href: toUrl(a.path) }));
}

export function ogImagePath(locale: LocaleId, pageId: string): string {
  return `/og/${locale}/${pageId}.jpg`;
}

/** Spec 2.4: one sitemap per language, live indexable pages only. */
export function sitemapGroups(
  mode: BuildMode,
  pages: readonly PageConfig[] = PAGES,
): Map<LocaleId, string[]> {
  const groups = new Map<LocaleId, string[]>();
  for (const entry of pageEntries(mode, pages)) {
    if (!indexable(entry, mode)) continue;
    groups.set(entry.locale, [...(groups.get(entry.locale) ?? []), entry.path]);
  }
  return groups;
}

const xmlText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function urlsetXml(urls: string[]): string {
  const rows = urls.map((url) => `<url><loc>${xmlText(url)}</loc></url>\n`).join("");
  return `${XML_HEAD}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}</urlset>\n`;
}

export function sitemapIndexXml(urls: string[]): string {
  const rows = urls.map((url) => `<sitemap><loc>${xmlText(url)}</loc></sitemap>\n`).join("");
  return `${XML_HEAD}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}</sitemapindex>\n`;
}

export function robotsTxt(mode: BuildMode, origin: string): string {
  return mode === "production"
    ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap-index.xml\n`
    : "User-agent: *\nDisallow: /\n";
}
