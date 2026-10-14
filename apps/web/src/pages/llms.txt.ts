import type { APIRoute } from "astro";
import { llmsTxt } from "../lib/llms.ts";
import { siteOrigin } from "../lib/site.ts";

export const GET: APIRoute = () =>
  new Response(llmsTxt(siteOrigin()), { headers: { "content-type": "text/plain; charset=utf-8" } });
