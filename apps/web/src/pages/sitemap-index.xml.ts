import type { APIRoute } from "astro";
import { sitemapGroups, sitemapIndexXml } from "../lib/seo.ts";
import { buildMode, siteOrigin } from "../lib/site.ts";

export const GET: APIRoute = () => {
  const urls = [...sitemapGroups(buildMode()).keys()].map(
    (locale) => `${siteOrigin()}/sitemap-${locale}.xml`,
  );
  return new Response(sitemapIndexXml(urls), { headers: { "content-type": "application/xml" } });
};
