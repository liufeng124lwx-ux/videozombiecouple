import { createMiddleware } from "hono/factory";
import type { AppEnv, Bindings } from "../types.ts";

type Jwk = JsonWebKey & { kid?: string };
let cached: { domain: string; at: number; keys: Jwk[] } | null = null;
const JWKS_MS = 60 * 60 * 1000;

async function keys(env: Bindings, fetchImpl: typeof fetch, fresh: boolean): Promise<Jwk[]> {
  const domain = env.ACCESS_TEAM_DOMAIN ?? "";
  if (!fresh && cached && cached.domain === domain && Date.now() - cached.at < JWKS_MS)
    return cached.keys;
  const response = await fetchImpl(`https://${domain}/cdn-cgi/access/certs`);
  const body = (await response.json()) as { keys?: Jwk[] };
  cached = { domain, at: Date.now(), keys: body.keys ?? [] };
  return cached.keys;
}

const bytes = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string) =>
  JSON.parse(new TextDecoder().decode(bytes(s))) as Record<string, unknown>;

/** Spec 8.1: a Cloudflare Access JWT for one of the admins; returns their email, or null. */
export async function verifyAccess(
  token: string,
  env: Bindings,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const [head, body, signature] = token.split(".");
    if (!head || !body || !signature) return null;
    const header = json(head);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    let jwk = (await keys(env, fetchImpl, false)).find((k) => k.kid === header.kid);
    // Access rotates its keys: an unknown kid means fetch them again, once.
    jwk ??= (await keys(env, fetchImpl, true)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      bytes(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
    if (!ok) return null;
    const claims = json(body);
    const now = Date.now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now + 60) return null;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(env.ACCESS_AUD)) return null;
    if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    const email = String(claims.email ?? "").toLowerCase();
    const admins = (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return admins.includes(email) ? email : null;
  } catch {
    return null;
  }
}

/** Spec 8.1: Access + the admin list; writes must come from the admin's own pages. */
export const adminOnly = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD || !c.env.ADMIN_EMAILS)
      return c.text("Not found", 404);
    const email = await verifyAccess(c.req.header("cf-access-jwt-assertion") ?? "", c.env);
    if (!email) return c.text("Forbidden", 403);
    if (c.req.method !== "GET" && c.req.header("origin") !== c.env.API_ORIGIN)
      return c.text("Forbidden", 403);
    c.set("adminEmail", email);
    c.header("x-robots-tag", "noindex");
    c.header("cache-control", "no-store");
    await next();
  });
