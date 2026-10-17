import type { PageConfig } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import {
  alternateLinks,
  ogImagePath,
  pageSchemas,
  robotsTxt,
  type SchemaInput,
  sitemapGroups,
  sitemapIndexXml,
  urlsetXml,
} from "./seo.ts";

const HOME = "https://videozombiecouple.com/";
const FAQ = [{ q: "Is the preview free?", a: "Yes, every day." }];
const STEPS = [
  { title: "Upload", text: "Add two photos." },
  { title: "Preview", text: "See the standoff and the memory." },
  { title: "Make the film", text: "Download the video." },
];
const landing = (over: Partial<SchemaInput> = {}): SchemaInput => ({
  kind: "landing",
  h1: "Zombie Love Story AI",
  url: "https://videozombiecouple.com/zombie-love-story-ai",
  homeUrl: HOME,
  image: "https://videozombiecouple.com/og/en/zombie-love-story-ai.jpg",
  content: {
    description: "Make a zombie love story video.",
    faq: FAQ,
    steps: STEPS,
    howTo: "How to make a zombie love story video",
  },
  ...over,
});
const types = (schemas: Record<string, unknown>[]) => schemas.map((s) => s["@type"]);

describe("structured data (spec 2.4)", () => {
  it("describes a landing page as an app with its FAQ, how-to and breadcrumb", () => {
    const schemas = pageSchemas(landing());
    expect(types(schemas)).toEqual(["WebApplication", "HowTo", "FAQPage", "BreadcrumbList"]);
    expect(schemas[0]).toMatchObject({
      "@context": "https://schema.org",
      name: "Zombie Love Story AI",
      url: "https://videozombiecouple.com/zombie-love-story-ai",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
    expect(schemas[1]).toMatchObject({
      name: "How to make a zombie love story video",
      step: [
        { "@type": "HowToStep", position: 1, name: "Upload", text: "Add two photos." },
        {},
        {},
      ],
    });
    expect(schemas[2]).toMatchObject({
      mainEntity: [
        {
          "@type": "Question",
          name: "Is the preview free?",
          acceptedAnswer: { text: "Yes, every day." },
        },
      ],
    });
    expect(schemas[3]).toMatchObject({
      itemListElement: [
        { position: 1, name: "Home", item: HOME },
        {
          position: 2,
          name: "Zombie Love Story AI",
          item: "https://videozombiecouple.com/zombie-love-story-ai",
        },
      ],
    });
  });

  it("gives the home page the organization and no breadcrumb", () => {
    const schemas = pageSchemas(landing({ kind: "home", h1: "Zombie Video Couple", url: HOME }));
    expect(types(schemas)).toEqual(["Organization", "WebApplication", "HowTo", "FAQPage"]);
    expect(schemas[0]).toMatchObject({
      legalName: "Arrayon Inc.",
      email: "hello@videozombiecouple.com",
    });
  });

  it("marks a blog post as an article", () => {
    const published = new Date("2026-10-09T00:00:00Z");
    const schemas = pageSchemas(
      landing({ kind: "blog", content: { description: "Prompts that work.", published } }),
    );
    expect(types(schemas)).toEqual(["Article", "BreadcrumbList"]);
    expect(schemas[0]).toMatchObject({ datePublished: "2026-10-09", dateModified: "2026-10-09" });
  });

  it("gives other pages only a breadcrumb, and skips pages without content", () => {
    expect(
      types(pageSchemas(landing({ kind: "legal", content: { description: "Terms." } }))),
    ).toEqual(["BreadcrumbList"]);
    expect(pageSchemas(landing({ content: null }))).toEqual([]);
    expect(types(pageSchemas(landing({ kind: "story" })))).toEqual([
      "HowTo",
      "FAQPage",
      "BreadcrumbList",
    ]);
  });
});

describe("hreflang links (spec 2.3)", () => {
  it("turns the catalog's alternates into absolute links (English only for now)", () => {
    const page: PageConfig = {
      id: "t",
      kind: "landing",
      locales: { en: { slug: "t", status: "live", h1: "T" } },
      related: [],
    };
    const toUrl = (path: string) => `https://videozombiecouple.com${path}`;
    expect(alternateLinks(page, "production", toUrl)).toEqual([
      { hreflang: "x-default", href: "https://videozombiecouple.com/t" },
      { hreflang: "en", href: "https://videozombiecouple.com/t" },
    ]);
  });
});

describe("sitemaps and robots (spec 2.4)", () => {
  it("lists live indexable pages per language", () => {
    const en = (slug: string, status: "live" | "draft" = "live") => ({
      en: { slug, status, h1: "H" },
    });
    const pages: PageConfig[] = [
      { id: "home", kind: "home", locales: en(""), related: [] },
      { id: "love", kind: "landing", locales: en("zombie-love-story-ai"), related: [] },
      { id: "pet", kind: "landing", locales: en("pet-zombie-video", "draft"), related: [] },
      { id: "story", kind: "story", noindex: true, locales: en("story"), related: [] },
      { id: "terms", kind: "legal", noindex: true, locales: en("terms"), related: [] },
    ];
    expect([...sitemapGroups("production", pages)]).toEqual([
      ["en", ["/", "/zombie-love-story-ai"]],
    ]);
    expect([...sitemapGroups("preview", pages)]).toEqual([]);
  });

  it("lists the catalog's live pages, never drafts, the story page, the account or policies", () => {
    expect([...sitemapGroups("production")]).toEqual([
      [
        "en",
        [
          "/",
          "/zombie-love-story-ai",
          "/pet-zombie-video",
          "/ai-christmas-video",
          "/zombie-couple-halloween",
          "/ai-zombie-filter",
          "/pricing",
          "/about",
          "/contact",
        ],
      ],
    ]);
  });

  it("writes standard sitemap XML", () => {
    expect(urlsetXml(["https://videozombiecouple.com/", "https://videozombiecouple.com/a&b"])).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://videozombiecouple.com/</loc></url>\n<url><loc>https://videozombiecouple.com/a&amp;b</loc></url>\n</urlset>\n',
    );
    expect(sitemapIndexXml(["https://videozombiecouple.com/sitemap-en.xml"])).toContain(
      "<sitemap><loc>https://videozombiecouple.com/sitemap-en.xml</loc></sitemap>",
    );
  });

  it("opens production to crawlers and closes every preview", () => {
    expect(robotsTxt("production", "https://videozombiecouple.com")).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://videozombiecouple.com/sitemap-index.xml\n",
    );
    expect(robotsTxt("preview", "https://staging.videozombiecouple.com")).toBe(
      "User-agent: *\nDisallow: /\n",
    );
  });

  it("names share images by locale and page", () => {
    expect(ogImagePath("en", "home")).toBe("/og/en/home.jpg");
  });
});
