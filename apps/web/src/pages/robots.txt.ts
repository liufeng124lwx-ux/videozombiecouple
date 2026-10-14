import type { APIRoute } from "astro";
import { robotsTxt } from "../lib/seo.ts";
import { buildMode, siteOrigin } from "../lib/site.ts";

export const GET: APIRoute = () =>
  new Response(robotsTxt(buildMode(), siteOrigin()), { headers: { "content-type": "text/plain" } });
