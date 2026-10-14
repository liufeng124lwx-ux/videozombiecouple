import { CAPABILITY_IDS } from "@vzc/catalog";
import type { ToolsView } from "@vzc/contracts";
import { padAspects } from "@vzc/providers";
import type { Context } from "hono";
import { loadRoutes } from "../services/routes-store.ts";
import type { AppEnv } from "../types.ts";

/**
 * Spec 3.1: the browser pads each photo to a ratio that every route of the capability accepts, so
 * the primary, fallback and free retry all share one upload and one cropBox. The API checks the
 * same list when the job is created.
 */
export async function tools(c: Context<AppEnv>) {
  const routes = await loadRoutes(c.env.DB);
  const view = Object.fromEntries(
    CAPABILITY_IDS.map((id) => [id, padAspects(routes, id)]),
  ) as ToolsView;
  c.header("cache-control", "public, max-age=300");
  return c.json(view);
}
