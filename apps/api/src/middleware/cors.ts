import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types.ts";

/** Browser API calls must come from our site (spec 7.1); webhooks and health are not under /v1. */
export const originGuard = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!c.req.path.startsWith("/v1/")) return next();
    const origin = c.req.header("origin");
    if (!origin || origin !== c.env.ALLOWED_ORIGIN) return c.text("Forbidden", 403);
    c.header("access-control-allow-origin", origin);
    c.header("access-control-allow-credentials", "true");
    c.header("vary", "Origin");
    if (c.req.method === "OPTIONS") {
      c.header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
      c.header("access-control-allow-headers", "content-type, x-turnstile, x-device");
      c.header("access-control-max-age", "600");
      return c.body(null, 204);
    }
    await next();
  });
