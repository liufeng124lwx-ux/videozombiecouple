import type { LocaleId } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import {
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
  mainText,
  parseHead,
  wordCount,
} from "./checks.ts";
import { built, html, ORIGIN } from "./fixtures.ts";

describe("parseHead", () => {
  it("reads the head and decodes entities", () => {
    const head = parseHead(
      html({ title: "Love &amp; Zombies &quot;Cabin&quot; – a long enough title" }),
    );
    expect(head.title).toBe('Love & Zombies "Cabin" – a long enough title');
    expect(head.canonical).toBe(`${ORIGIN}/`);
    expect(head.lang).toBe("en");
    expect(head.h1s).toEqual(["Zombie Video Couple"]);
  });

  it("maps paths to the files a build.format=file build writes", () => {
    expect(fileFor("/")).toBe("index.html");
    expect(fileFor("/pricing")).toBe("pricing.html");
    expect(fileFor("/zombie-love-story-prompts")).toBe("zombie-love-story-prompts.html");
  });
});

describe("checkHead (spec 2.5 rules 1–3)", () => {
  it("passes a good page", () => {
    expect(checkHead([built()], ORIGIN)).toEqual([]);
  });

  it("flags titles and descriptions outside the length limits", () => {
    const page = built({ html: html({ title: "Too short", description: "Also short." }) });
    expect(checkHead([page], ORIGIN)).toEqual([
      expect.stringContaining("title has 9 characters"),
      expect.stringContaining("description has 11 characters"),
    ]);
  });

  it("flags a title or description used twice", () => {
    const twin = built({ path: "/pricing", html: html({ canonical: `${ORIGIN}/pricing` }) });
    expect(checkHead([built(), twin], ORIGIN)).toEqual([
      expect.stringContaining("/pricing: same title as /"),
      expect.stringContaining("/pricing: same description as /"),
    ]);
  });

  it("flags missing, extra and wrong H1s", () => {
    expect(checkHead([built({ html: html({ h1s: [] }) })], ORIGIN)).toEqual([
      expect.stringContaining("has 0 H1s"),
    ]);
    expect(checkHead([built({ html: html({ h1s: ["A", "B"] }) })], ORIGIN)).toEqual([
      expect.stringContaining("has 2 H1s"),
    ]);
    expect(
      checkHead([built({ html: html({ h1s: ["Zombie Video <em>Couples</em>"] }) })], ORIGIN),
    ).toEqual([
      expect.stringContaining(
        'H1 "Zombie Video Couples" is not the catalog h1 "Zombie Video Couple"',
      ),
    ]);
  });

  it("flags a canonical that is not the page itself", () => {
    expect(checkHead([built({ html: html({ canonical: `${ORIGIN}/index` }) })], ORIGIN)).toEqual([
      expect.stringContaining("canonical is https://videozombiecouple.com/index"),
    ]);
    expect(checkHead([built({ html: html({ canonical: null }) })], ORIGIN)).toEqual([
      expect.stringContaining("canonical is null"),
    ]);
  });

  it("flags robots that disagree with whether the page may be indexed", () => {
    expect(checkHead([built({ html: html({ robots: "noindex" }) })], ORIGIN)).toEqual([
      expect.stringContaining("indexable page has noindex"),
    ]);
    expect(checkHead([built({ indexable: false })], ORIGIN)).toEqual([
      expect.stringContaining("must be noindex"),
    ]);
  });
});

describe("checkPreview (spec 2.1)", () => {
  it("requires noindex on every page of a preview build", () => {
    expect(checkPreview([built({ html: html({ robots: "noindex" }) })])).toEqual([]);
    expect(checkPreview([built()])).toEqual(["/: preview page without noindex"]);
  });
});

function translated(path: string, lang: string, links: [string, string][]) {
  const head = links
    .map(([hreflang, to]) => `<link rel="alternate" hreflang="${hreflang}" href="${ORIGIN}${to}">`)
    .join("");
  return built({
    path,
    locale: lang as LocaleId,
    html: html({ canonical: `${ORIGIN}${path}`, head }).replace('lang="en"', `lang="${lang}"`),
  });
}
const BOTH: [string, string][] = [
  ["x-default", "/tool"],
  ["en", "/tool"],
  ["es", "/es/herramienta"],
];

describe("checkAlternates (spec 2.5 rule 3)", () => {
  it("passes pages that list each other and themselves", () => {
    const pages = [translated("/tool", "en", BOTH), translated("/es/herramienta", "es", BOTH)];
    expect(checkAlternates(pages, ORIGIN)).toEqual([]);
  });

  it("flags a page that leaves itself or x-default out", () => {
    const partial: [string, string][] = [["es", "/es/herramienta"]];
    const errors = checkAlternates(
      [translated("/tool", "en", partial), translated("/es/herramienta", "es", BOTH)],
      ORIGIN,
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        "/tool: hreflang does not list the page itself as en",
        "/tool: no x-default hreflang",
        expect.stringContaining("/tool: hreflang list differs from /es/herramienta"),
      ]),
    );
  });

  it("flags a link to a page that was not built", () => {
    const errors = checkAlternates([translated("/tool", "en", BOTH)], ORIGIN);
    expect(errors).toEqual([
      "/tool: hreflang es points to https://videozombiecouple.com/es/herramienta, which was not built",
    ]);
  });
});

const urlset = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const index = (urls: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex>${urls.map((u) => `<sitemap><loc>${u}</loc></sitemap>`).join("")}</sitemapindex>`;

describe("checkSitemaps (spec 2.5 rule 5)", () => {
  const home = built();
  const terms = built({ path: "/terms", indexable: false });

  it("passes when the sitemaps hold exactly the live indexable pages", () => {
    const files = {
      index: index([`${ORIGIN}/sitemap-en.xml`]),
      byLocale: { en: urlset([`${ORIGIN}/`]) },
    };
    expect(checkSitemaps([home, terms], files, ORIGIN)).toEqual([]);
  });

  it("flags missing pages, extra pages and a broken index", () => {
    const files = { index: null, byLocale: { en: urlset([`${ORIGIN}/terms`]) } };
    expect(checkSitemaps([home, terms], files, ORIGIN)).toEqual([
      "sitemap-index.xml is missing",
      "sitemap-en.xml lists https://videozombiecouple.com/terms, which is not a live indexable page",
      "no sitemap lists https://videozombiecouple.com/",
    ]);
  });

  it("flags a page in another language's sitemap and an index that skips a sitemap", () => {
    const spanish = built({ path: "/es", locale: "es" as LocaleId });
    const files = {
      index: index([`${ORIGIN}/sitemap-en.xml`]),
      byLocale: { en: urlset([`${ORIGIN}/`, `${ORIGIN}/es`]), es: urlset([]) },
    };
    expect(checkSitemaps([home, spanish], files, ORIGIN)).toEqual([
      "sitemap-index.xml does not list https://videozombiecouple.com/sitemap-es.xml",
      "sitemap-en.xml lists https://videozombiecouple.com/es, which belongs in sitemap-es.xml",
    ]);
  });
});

const ld = (schema: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;

describe("checkStructuredData (spec 2.4)", () => {
  it("passes when every required type is there", () => {
    const page = built({
      path: "/terms",
      kind: "legal",
      html: html({ head: ld({ "@type": "BreadcrumbList" }) }),
    });
    expect(checkStructuredData([page])).toEqual([]);
  });

  it("flags JSON that does not parse and missing types", () => {
    const broken = built({
      path: "/terms",
      kind: "legal",
      html: html({ head: '<script type="application/ld+json">{"@type":</script>' }),
    });
    expect(checkStructuredData([broken])).toEqual([
      "/terms: structured data is not valid JSON",
      "/terms: missing BreadcrumbList structured data",
    ]);
  });
});

describe("checkOgImages (spec 2.5 rule 7)", () => {
  const og = (url: string) => `<meta property="og:image" content="${url}">`;

  it("passes a page whose share image was built", () => {
    const page = built({ html: html({ head: og(`${ORIGIN}/og/en/home.jpg`) }) });
    expect(checkOgImages([page], (file) => file === "og/en/home.jpg", ORIGIN)).toEqual([]);
  });

  it("flags a missing tag, a missing file and an image on another site", () => {
    const pages = [
      built({ path: "/a" }),
      built({ path: "/b", html: html({ head: og(`${ORIGIN}/og/en/b.jpg`) }) }),
      built({ path: "/c", html: html({ head: og("https://cdn.example.com/c.jpg") }) }),
    ];
    expect(checkOgImages(pages, () => false, ORIGIN)).toEqual([
      "/a: no og:image",
      "/b: og:image og/en/b.jpg was not built",
      "/c: og:image https://cdn.example.com/c.jpg is not on this site",
    ]);
  });
});

describe("checkLinks (spec 2.5 rule 4)", () => {
  const page = (body: string) => ({ path: "/", html: html({ body }) });
  const pagePaths = new Set(["/", "/pricing"]);
  const drafts = new Set(["/pet-zombie-video"]);
  const files = (file: string) => file === "og/en/home.jpg";

  it("passes links to built pages, files, anchors and other sites", () => {
    const body =
      '<a href="/pricing#packs">p</a><a href="/">h</a><a href="/og/en/home.jpg">o</a><a href="#main">s</a><a href="https://videozombiecouple.com/x">x</a><a href="mailto:hello@videozombiecouple.com">m</a>';
    expect(checkLinks([page(body)], files, pagePaths, drafts)).toEqual([]);
  });

  it("flags dead links, links to drafts and trailing slashes", () => {
    const body = '<a href="/nope">a</a><a href="/pet-zombie-video">b</a><a href="/pricing/">c</a>';
    expect(checkLinks([page(body)], files, pagePaths, drafts)).toEqual([
      "/: dead link /nope",
      "/: links to the draft page /pet-zombie-video",
      "/: link /pricing/ ends with a slash",
    ]);
  });
});

const section = (name: string, words = 0) =>
  `<section data-section="${name}">${Array(words).fill("word").join(" ")}</section>`;
const HOME = ["hero", "tool", "beats", "scenes", "steps", "pricing", "faq"];
const SECTIONS = { home: HOME };

describe("checkToolPages (spec 2.2, 2.5 rule 6)", () => {
  const story = (sections: string, kind: "home" | "landing" | "legal" = "home") =>
    built({ path: "/", kind, html: html({ body: sections }) });

  it("counts words, not tags or numbers-only noise", () => {
    expect(wordCount("Make a zombie love story — in 3 steps.")).toBe(7);
  });

  it("passes a page with every section in order and enough words", () => {
    const body = HOME.map((s) => section(s, s === "faq" ? 1300 : 0)).join("") + section("closing");
    expect(checkToolPages([story(body)], SECTIONS)).toEqual([]);
  });

  it("flags sections out of order or missing", () => {
    const body = ["hero", "beats", "tool", "faq"]
      .map((s) => section(s, s === "faq" ? 1300 : 0))
      .join("");
    expect(checkToolPages([story(body)], SECTIONS)).toEqual([
      "/: sections are hero → beats → tool → faq, should be hero → tool → beats → scenes → steps → pricing → faq",
    ]);
  });

  it("flags home and landing pages that are too short or too long, and only those", () => {
    const short = section("faq", 100);
    const long = section("faq", 2000);
    expect(checkToolPages([story(short)])).toEqual([
      expect.stringContaining("/: 103 words, needs 1200–1800"),
    ]);
    expect(checkToolPages([story(long, "landing")])).toEqual([
      expect.stringContaining("words, needs 1200–1800"),
    ]);
    expect(checkToolPages([story(short, "legal")])).toEqual([]);
  });

  it("does not count text hidden from readers, like the filmstrip's loop copies", () => {
    expect(
      mainText('<main><p>One two</p><div aria-hidden="true"><p>three four</p></div></main>'),
    ).toBe("One two");
  });
});

describe("checkVideos (plan Task 8)", () => {
  it("asks every video to wait until it is seen or played", () => {
    const ok = built({ html: html({ body: '<video preload="none" src="/a.mp4"></video>' }) });
    const eager = built({ path: "/b", html: html({ body: '<video src="/b.mp4"></video>' }) });
    expect(checkVideos([ok, eager])).toEqual(['/b: a <video> without preload="none" (/b.mp4)']);
  });
});
