import type { LocaleId } from "@vzc/catalog";
import type { APIRoute, GetStaticPaths } from "astro";
import { sitemapGroups, urlsetXml } from "../lib/seo.ts";
import { absoluteUrl, buildMode } from "../lib/site.ts";

export const getStaticPaths: GetStaticPaths = () =>
  [...sitemapGroups(buildMode()).keys()].map((locale) => ({ params: { locale } }));

export const GET: APIRoute = ({ params }) => {
  const paths = sitemapGroups(buildMode()).get(params.locale as LocaleId) ?? [];
  return new Response(urlsetXml(paths.map((path) => absoluteUrl(path))), {
    headers: { "content-type": "application/xml" },
  });
};
