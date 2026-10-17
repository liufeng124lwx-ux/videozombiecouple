import type { LocaleId, PageKind } from "@vzc/catalog";

/** One catalog page as the build wrote it. */
export type BuiltPage = {
  path: string;
  locale: LocaleId;
  h1: string;
  kind: PageKind;
  indexable: boolean;
  draft: boolean;
  html: string;
};

export const TITLE = { min: 30, max: 60 } as const;
export const DESCRIPTION = { min: 120, max: 160 } as const;

/** build.format "file": "/" → index.html, "/pricing" → pricing.html. */
export function fileFor(path: string): string {
  return path === "/" ? "index.html" : `${path.slice(1)}.html`;
}

export function canonicalFor(path: string, origin: string): string {
  return path === "/" ? `${origin}/` : `${origin}${path}`;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  "#39": "'",
  "#x27": "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

export function decode(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name] ?? match);
}

export function stripTags(html: string): string {
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");
}

/** The attributes of every `<name …>` tag, names lower-cased, values decoded. */
export function tags(html: string, name: string): Record<string, string>[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map((match) => {
    const attributes: Record<string, string> = {};
    for (const attr of (match[1] ?? "").matchAll(/([^\s="'/]+)(?:\s*=\s*"([^"]*)")?/g))
      attributes[(attr[1] ?? "").toLowerCase()] = decode(attr[2] ?? "");
    return attributes;
  });
}

export type Head = {
  title: string;
  description: string;
  canonical: string | null;
  robots: string | null;
  lang: string | null;
  h1s: string[];
};

export function parseHead(html: string): Head {
  const meta = tags(html, "meta");
  return {
    title: decode(html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "").trim(),
    description: meta.find((m) => m.name === "description")?.content ?? "",
    canonical: tags(html, "link").find((l) => l.rel === "canonical")?.href ?? null,
    robots: meta.find((m) => m.name === "robots")?.content ?? null,
    lang: tags(html, "html")[0]?.lang ?? null,
    h1s: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
      decode(stripTags(m[1] ?? ""))
        .replace(/\s+/g, " ")
        .trim(),
    ),
  };
}

/** Spec 2.5 rules 1–3 (the head): titles and descriptions, the one H1, canonical, robots. */
export function checkHead(pages: BuiltPage[], origin: string): string[] {
  const errors: string[] = [];
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  for (const page of pages) {
    const head = parseHead(page.html);
    const at = page.path;
    if (head.title.length < TITLE.min || head.title.length > TITLE.max)
      errors.push(
        `${at}: title has ${head.title.length} characters, needs ${TITLE.min}–${TITLE.max}`,
      );
    if (head.description.length < DESCRIPTION.min || head.description.length > DESCRIPTION.max)
      errors.push(
        `${at}: description has ${head.description.length} characters, needs ${DESCRIPTION.min}–${DESCRIPTION.max}`,
      );
    const sameTitle = titles.get(head.title);
    if (sameTitle !== undefined) errors.push(`${at}: same title as ${sameTitle}`);
    titles.set(head.title, at);
    const sameDescription = descriptions.get(head.description);
    if (sameDescription !== undefined) errors.push(`${at}: same description as ${sameDescription}`);
    descriptions.set(head.description, at);
    if (head.h1s.length !== 1) errors.push(`${at}: has ${head.h1s.length} H1s, needs exactly one`);
    else if (head.h1s[0] !== page.h1)
      errors.push(`${at}: H1 "${head.h1s[0]}" is not the catalog h1 "${page.h1}"`);
    const canonical = canonicalFor(page.path, origin);
    if (head.canonical !== canonical)
      errors.push(`${at}: canonical is ${head.canonical}, should be ${canonical}`);
    const noindex = head.robots?.includes("noindex") === true;
    if (page.indexable && noindex) errors.push(`${at}: indexable page has noindex`);
    if (!page.indexable && !noindex) errors.push(`${at}: page must be noindex`);
  }
  return errors;
}

/** Spec 2.1: a preview build keeps every page out of search engines. */
export function checkPreview(pages: BuiltPage[]): string[] {
  return pages
    .filter((page) => parseHead(page.html).robots?.includes("noindex") !== true)
    .map((page) => `${page.path}: preview page without noindex`);
}

type Link = { hreflang: string; href: string };

function hreflangLinks(html: string): Link[] {
  return tags(html, "link")
    .filter((l) => l.rel === "alternate" && l.hreflang !== undefined)
    .map((l) => ({ hreflang: l.hreflang ?? "", href: l.href ?? "" }));
}

const linkKey = (links: Link[]) =>
  links
    .map((l) => `${l.hreflang} ${l.href}`)
    .sort()
    .join("\n");

/** Spec 2.5 rule 3: every page lists itself and x-default, and every listed page lists the same set. */
export function checkAlternates(pages: BuiltPage[], origin: string): string[] {
  const errors: string[] = [];
  const byUrl = new Map(pages.map((p) => [canonicalFor(p.path, origin), p]));
  for (const page of pages) {
    const links = hreflangLinks(page.html);
    const lang = parseHead(page.html).lang ?? "";
    const self = canonicalFor(page.path, origin);
    if (!links.some((l) => l.hreflang === lang && l.href === self))
      errors.push(`${page.path}: hreflang does not list the page itself as ${lang}`);
    if (!links.some((l) => l.hreflang === "x-default"))
      errors.push(`${page.path}: no x-default hreflang`);
    for (const link of links) {
      if (link.hreflang === "x-default" || link.href === self) continue;
      const target = byUrl.get(link.href);
      if (!target) {
        errors.push(
          `${page.path}: hreflang ${link.hreflang} points to ${link.href}, which was not built`,
        );
        continue;
      }
      if (linkKey(hreflangLinks(target.html)) !== linkKey(links))
        errors.push(`${page.path}: hreflang list differs from ${target.path}`);
    }
  }
  return errors;
}

const locs = (xml: string) =>
  [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1] ?? ""));

export type SitemapFiles = { index: string | null; byLocale: Record<string, string> };

/** Spec 2.5 rule 5: the sitemaps and the live indexable pages match one to one. */
export function checkSitemaps(pages: BuiltPage[], files: SitemapFiles, origin: string): string[] {
  const errors: string[] = [];
  const wanted = new Map(
    pages.filter((p) => p.indexable).map((p) => [canonicalFor(p.path, origin), p.locale]),
  );
  if (files.index === null) errors.push("sitemap-index.xml is missing");
  else {
    const listed = new Set(locs(files.index));
    for (const locale of Object.keys(files.byLocale)) {
      const url = `${origin}/sitemap-${locale}.xml`;
      if (!listed.has(url)) errors.push(`sitemap-index.xml does not list ${url}`);
    }
  }
  const seen = new Set<string>();
  for (const [locale, xml] of Object.entries(files.byLocale)) {
    for (const url of locs(xml)) {
      const owner = wanted.get(url);
      if (owner === undefined)
        errors.push(`sitemap-${locale}.xml lists ${url}, which is not a live indexable page`);
      else if (owner !== locale)
        errors.push(`sitemap-${locale}.xml lists ${url}, which belongs in sitemap-${owner}.xml`);
      seen.add(url);
    }
  }
  for (const url of wanted.keys()) if (!seen.has(url)) errors.push(`no sitemap lists ${url}`);
  return errors;
}

/** Structured data each kind of page must carry (spec 2.4). The story page is noindex and has none. */
export const REQUIRED_SCHEMAS: Partial<Record<PageKind, string[]>> = {
  home: ["Organization", "WebApplication", "HowTo", "FAQPage"],
  landing: ["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"],
  photo: ["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"],
  pricing: ["FAQPage", "BreadcrumbList"],
  account: ["BreadcrumbList"],
  legal: ["BreadcrumbList"],
  blog: ["Article", "BreadcrumbList"],
};

export function checkStructuredData(pages: BuiltPage[]): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    const found = new Set<string>();
    for (const m of page.html.matchAll(
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    )) {
      try {
        const type = (JSON.parse(m[1] ?? "") as { "@type"?: unknown })["@type"];
        if (typeof type === "string") found.add(type);
      } catch {
        errors.push(`${page.path}: structured data is not valid JSON`);
      }
    }
    for (const type of REQUIRED_SCHEMAS[page.kind] ?? [])
      if (!found.has(type)) errors.push(`${page.path}: missing ${type} structured data`);
  }
  return errors;
}

/** Spec 2.5 rule 7: every page has a share image, and it is a file of this build. */
export function checkOgImages(
  pages: BuiltPage[],
  exists: (file: string) => boolean,
  origin: string,
): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    const url = tags(page.html, "meta").find((m) => m.property === "og:image")?.content;
    if (!url) errors.push(`${page.path}: no og:image`);
    else if (!url.startsWith(`${origin}/`))
      errors.push(`${page.path}: og:image ${url} is not on this site`);
    else {
      const file = url.slice(origin.length + 1);
      if (!exists(file)) errors.push(`${page.path}: og:image ${file} was not built`);
    }
  }
  return errors;
}

/** Spec 2.5 rule 4: internal links reach a built page or file, never a draft, never with a trailing slash. */
export function checkLinks(
  sources: { path: string; html: string }[],
  exists: (file: string) => boolean,
  pagePaths: Set<string>,
  draftPaths: Set<string>,
): string[] {
  const errors: string[] = [];
  for (const source of sources) {
    for (const anchor of tags(source.html, "a")) {
      const href = anchor.href ?? "";
      if (!href.startsWith("/") || href.startsWith("//")) continue;
      const target = href.split(/[?#]/)[0] ?? "";
      if (target !== "/" && target.endsWith("/"))
        errors.push(`${source.path}: link ${href} ends with a slash`);
      else if (draftPaths.has(target))
        errors.push(`${source.path}: links to the draft page ${target}`);
      else if (!pagePaths.has(target) && !exists(target.slice(1)))
        errors.push(`${source.path}: dead link ${href}`);
    }
  }
  return errors;
}

/** The readable text of <main>: no header, footer, scripts, attributes or aria-hidden copies. */
export function mainText(html: string): string {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
  return decode(stripTags(dropHidden(main)))
    .replace(/\s+/g, " ")
    .trim();
}

/** Removes elements marked aria-hidden="true", nesting included. */
function dropHidden(html: string): string {
  let out = html;
  for (;;) {
    const open = out.match(/<(\w+)\b[^>]*\baria-hidden="true"[^>]*>/);
    if (!open || open.index === undefined) return out;
    const tag = open[1] as string;
    const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, "g");
    re.lastIndex = open.index;
    let depth = 0;
    let end = out.length;
    for (let m = re.exec(out); m; m = re.exec(out)) {
      depth += m[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    out = out.slice(0, open.index) + out.slice(end);
  }
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /\p{L}/u.test(word)).length;
}

export const WORDS = { min: 1200, max: 1800 } as const;
/** Spanish, Portuguese and French take about a tenth more words than English to say the same. */
const wordsFor = (locale: LocaleId) =>
  locale === "en" ? WORDS : { min: WORDS.min, max: Math.round(WORDS.max * 1.1) };

/** Plan Task 6: the home and landing pages carry 1,200–1,800 words of real text. */
export const LONG_KINDS: readonly PageKind[] = ["home", "landing", "photo"];

/**
 * Section order (`data-section="…"`) a kind of page must keep. Empty until the home and landing
 * templates (plan Task 6) settle their sections; add them here so the order can't drift.
 */
export const TOOL_SECTIONS: Partial<Record<PageKind, string[]>> = {};
/** Optional sections that may follow the required ones, in this order. */
const TAIL = ["related", "closing"];

/** UI strings this long are sentences: one in English on a translated page means a missed locale. */
const LEAK_MIN = 20;

/** i18n spec: a translated page has its own lang and no English UI sentence (text or attribute). */
export function checkLanguage(
  pages: BuiltPage[],
  en: Record<string, string>,
  translations: Partial<Record<LocaleId, Record<string, string>>>,
): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    if (page.locale === "en") continue;
    const lang = page.html.match(/<html[^>]*\slang="([^"]*)"/)?.[1];
    if (lang !== page.locale)
      errors.push(`${page.path}: lang is "${lang}", should be "${page.locale}"`);
    const own = translations[page.locale] ?? {};
    // The page's inlined strings (__vzcMessages) hold the translations, never English.
    const body = decode(page.html.slice(page.html.indexOf("<body")));
    for (const [key, text] of Object.entries(en)) {
      if (text.length < LEAK_MIN || text.includes("{") || own[key] === text) continue;
      if (body.includes(text))
        errors.push(`${page.path}: English text "${text}" (${key}) on a ${page.locale} page`);
    }
  }
  return errors;
}

/** Spec 2.2 and 2.5 rule 6: story pages keep their section order and have 1,200–1,800 words. */
export function checkToolPages(
  pages: BuiltPage[],
  sections: Partial<Record<PageKind, string[]>> = TOOL_SECTIONS,
): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    const required = sections[page.kind];
    if (required) {
      const found = [...page.html.matchAll(/data-section="([\w-]+)"/g)].map((m) => m[1] ?? "");
      const wanted = [...required, ...TAIL.filter((s) => found.includes(s))];
      if (found.join() !== wanted.join())
        errors.push(
          `${page.path}: sections are ${found.join(" → ")}, should be ${wanted.join(" → ")}`,
        );
    }
    if (!LONG_KINDS.includes(page.kind)) continue;
    const words = wordCount(mainText(page.html));
    const range = wordsFor(page.locale);
    if (words < range.min || words > range.max)
      errors.push(`${page.path}: ${words} words, needs ${range.min}–${range.max}`);
  }
  return errors;
}

/** Plan Task 8: sample films load only when seen or played, never with the page. */
export function checkVideos(pages: BuiltPage[]): string[] {
  const errors: string[] = [];
  for (const page of pages)
    for (const video of tags(page.html, "video"))
      if (video.preload !== "none")
        errors.push(`${page.path}: a <video> without preload="none" (${video.src ?? "no src"})`);
  return errors;
}
