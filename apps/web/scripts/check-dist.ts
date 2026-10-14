import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type BuildMode,
  indexable,
  isLive,
  LOCALE_IDS,
  PAGES,
  pageEntries,
  pagePath,
} from "@vzc/catalog";
import {
  type BuiltPage,
  checkAlternates,
  checkHead,
  checkLinks,
  checkOgImages,
  checkPreview,
  checkSitemaps,
  checkStructuredData,
  checkToolPages,
  checkVideos,
  fileFor,
} from "./checks.ts";

/** Spec 2.5: checks the built site; any problem fails CI. `--preview` checks a preview build. */
const mode: BuildMode = process.argv.includes("--preview") ? "preview" : "production";
const dist = resolve(import.meta.dirname, "../dist");
const origin = (process.env.PUBLIC_SITE_ORIGIN || "https://videozombiecouple.com").replace(
  /\/+$/,
  "",
);

function read(file: string): string {
  const path = join(dist, file);
  if (!existsSync(path))
    throw new Error(
      `Missing ${path}; run pnpm ${mode === "production" ? "build:production" : "build"} first`,
    );
  return readFileSync(path, "utf8");
}

const pages: BuiltPage[] = pageEntries(mode).map((entry) => ({
  path: entry.path,
  locale: entry.locale,
  h1: entry.page.locales[entry.locale]?.h1 ?? "",
  kind: entry.page.kind,
  indexable: indexable(entry, mode),
  draft: entry.draft,
  html: read(fileFor(entry.path)),
}));

function sitemapFiles() {
  const byLocale: Record<string, string> = {};
  for (const name of readdirSync(dist)) {
    const locale = name.match(/^sitemap-(.+)\.xml$/)?.[1];
    if (locale && locale !== "index") byLocale[locale] = read(name);
  }
  return {
    index: existsSync(join(dist, "sitemap-index.xml")) ? read("sitemap-index.xml") : null,
    byLocale,
  };
}

const errors =
  mode === "production"
    ? [
        ...checkHead(pages, origin),
        ...checkAlternates(pages, origin),
        ...checkSitemaps(pages, sitemapFiles(), origin),
        ...checkStructuredData(pages),
        ...checkToolPages(pages),
        ...checkVideos(pages),
        ...checkOgImages(pages, (file) => existsSync(join(dist, file)), origin),
        ...checkLinks(
          [...pages, { path: "/404", html: read("404.html") }],
          (file) => existsSync(join(dist, file)),
          new Set(pages.map((p) => p.path)),
          new Set(
            PAGES.flatMap((page) =>
              LOCALE_IDS.filter((l) => page.locales[l] !== undefined && !isLive(page, l)).map((l) =>
                pagePath(page, l),
              ),
            ),
          ),
        ),
      ]
    : [
        ...checkPreview(pages),
        ...checkToolPages(pages.filter((p) => p.html.includes('data-section="hero"'))),
      ];

if (errors.length > 0) {
  console.error(`check-dist (${mode}): ${errors.length} problem(s)\n${errors.join("\n")}`);
  process.exit(1);
}
console.log(`check-dist (${mode}): ${pages.length} pages OK`);
