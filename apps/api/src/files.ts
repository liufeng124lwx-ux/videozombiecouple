import { Hono } from "hono";
import { hmacHex, safeEqual } from "./services/crypto.ts";
import type { AppEnv, Bindings } from "./types.ts";

/**
 * Signed file links served by the API itself (no R2 S3 keys needed): the browser uploads photos,
 * kie and the composer read inputs, the composer writes the film, and the player streams it. A
 * link names one key, one method and an expiry; uploads also fix the size and the content type.
 */
export function filesProxied(env: Bindings): boolean {
  return !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY;
}

const payload = (method: string, key: string, exp: number, type: string, length: string) =>
  `files|${method}|${key}|${exp}|${type}|${length}`;

export async function fileUrl(
  env: Bindings,
  key: string,
  method: "GET" | "PUT",
  expiresSec: number,
  signedHeaders: Record<string, string> = {},
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + expiresSec;
  const type = signedHeaders["content-type"] ?? "";
  const length = signedHeaders["content-length"] ?? "";
  const sig = await hmacHex(payload(method, key, exp, type, length), env.HMAC_KEY);
  const query = new URLSearchParams({ m: method, exp: String(exp), sig });
  if (type) query.set("t", type);
  if (length) query.set("l", length);
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${env.API_ORIGIN}/files/${path}?${query}`;
}

export const files = new Hono<AppEnv>();

files.use("*", async (c, next) => {
  c.header("access-control-allow-origin", c.env.ALLOWED_ORIGIN);
  c.header("vary", "Origin");
  c.header("access-control-expose-headers", "content-length, content-range, accept-ranges");
  if (c.req.method === "OPTIONS") {
    c.header("access-control-allow-methods", "GET, HEAD, PUT");
    c.header("access-control-allow-headers", "content-type, range");
    c.header("access-control-max-age", "600");
    return c.body(null, 204);
  }
  await next();
});

function parseRange(
  header: string | undefined,
  size: number,
): { offset: number; length: number } | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  let start = m[1] ? Number(m[1]) : Number.NaN;
  let end = m[2] ? Number(m[2]) : size - 1;
  if (Number.isNaN(start)) {
    // "bytes=-500": the last 500 bytes
    start = Math.max(0, size - end);
    end = size - 1;
  }
  if (start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { offset: start, length: end - start + 1 };
}

files.on(["GET", "HEAD", "PUT"], "/*", async (c) => {
  const key = c.req.path
    .replace(/^\/files\//, "")
    .split("/")
    .map(decodeURIComponent)
    .join("/");
  const method = c.req.method === "HEAD" ? "GET" : (c.req.method as "GET" | "PUT");
  const exp = Number(c.req.query("exp"));
  const type = c.req.query("t") ?? "";
  const length = c.req.query("l") ?? "";
  const expected = await hmacHex(payload(method, key, exp, type, length), c.env.HMAC_KEY);
  if (
    c.req.query("m") !== method ||
    !safeEqual(c.req.query("sig") ?? "", expected) ||
    !(exp * 1000 > Date.now()) ||
    key.includes("..")
  )
    return c.text("Forbidden", 403);

  if (method === "PUT") {
    if (type && (c.req.header("content-type") ?? "") !== type) return c.text("Forbidden", 403);
    const body = await c.req.arrayBuffer();
    if (length && String(body.byteLength) !== length) return c.text("Forbidden", 403);
    await c.env.BUCKET.put(key, body, {
      httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
    });
    return c.body(null, 200);
  }

  const head = await c.env.BUCKET.head(key);
  if (!head) return c.text("Not found", 404);
  const headers: Record<string, string> = {
    "content-type": head.httpMetadata?.contentType ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=600",
  };
  const range = parseRange(c.req.header("range"), head.size);
  if (c.req.method === "HEAD")
    return c.body(null, 200, { ...headers, "content-length": String(head.size) });
  const object = await c.env.BUCKET.get(key, range ? { range } : undefined);
  if (!object) return c.text("Not found", 404);
  const bytes = await object.arrayBuffer();
  if (range)
    return c.body(bytes, 206, {
      ...headers,
      "content-range": `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`,
    });
  return c.body(bytes, 200, headers);
});
