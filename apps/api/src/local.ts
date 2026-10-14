import { Hono } from "hono";
import { hmacHex, safeEqual } from "./services/crypto.ts";
import type { AppEnv, Bindings } from "./types.ts";

/** The Turnstile token end-to-end runs send; accepted only in local mode. */
export const LOCAL_TURNSTILE_TOKEN = "local-dev-pass";

/**
 * Plan 7C: end-to-end runs against `wrangler dev`. Needs the flag AND a localhost API, so a stray
 * flag in a deployed config does nothing (and a test keeps it out of both configs).
 */
export function isLocal(env: Bindings): boolean {
  return (
    env.LOCAL_DEV === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.API_ORIGIN ?? "")
  );
}

/** Stands in for an R2 presigned URL: served by the API from wrangler's local bucket. */
export async function localUrl(
  env: Bindings,
  key: string,
  method: "GET" | "PUT",
  expiresSec: number,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expiresSec;
  const sig = await hmacHex(`local-r2|${method}|${key}|${exp}`, env.HMAC_KEY);
  return `${env.API_ORIGIN}/local-r2/${key}?m=${method}&exp=${exp}&sig=${sig}`;
}

export const localR2 = new Hono<AppEnv>();
localR2.use("*", async (c, next) => {
  if (!isLocal(c.env)) return c.text("Not found", 404);
  c.header("access-control-allow-origin", c.env.ALLOWED_ORIGIN);
  c.header("vary", "Origin");
  if (c.req.method === "OPTIONS") {
    c.header("access-control-allow-methods", "GET, PUT");
    c.header("access-control-allow-headers", "content-type");
    return c.body(null, 204);
  }
  await next();
});
localR2.on(["GET", "PUT"], "/*", async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/local-r2\//, ""));
  const method = c.req.method as "GET" | "PUT";
  const exp = Number(c.req.query("exp"));
  const expected = await hmacHex(`local-r2|${method}|${key}|${exp}`, c.env.HMAC_KEY);
  if (
    c.req.query("m") !== method ||
    !safeEqual(c.req.query("sig") ?? "", expected) ||
    !(exp * 1000 > Date.now())
  )
    return c.text("Forbidden", 403);
  if (method === "PUT") {
    await c.env.BUCKET.put(key, await c.req.arrayBuffer(), {
      httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
    });
    return c.body(null, 200);
  }
  const object = await c.env.BUCKET.get(key);
  if (!object) return c.text("Not found", 404);
  return c.body(await object.arrayBuffer(), 200, {
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
  });
});
