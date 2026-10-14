import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { completeLogin, safeNext } from "../services/login.ts";
import { randomHex } from "../services/session.ts";
import type { AppEnv } from "../types.ts";

// OAuth 2.0 authorization code + PKCE (copied from Vidova). Served outside /v1 because the browser
// arrives here by navigation, without an Origin header.

const STATE_TTL_SEC = 600;
const stateCookie = (c: Context<AppEnv>) =>
  c.env.ALLOWED_ORIGIN.includes("staging") ? "upx_gstate_stg" : "upx_gstate";

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const callbackUrl = (c: Context<AppEnv>) => `${new URL(c.req.url).origin}/auth/google/callback`;
const failed = (c: Context<AppEnv>) =>
  c.redirect(`${c.env.ALLOWED_ORIGIN}/account?error=google`, 302);

export async function googleStart(c: Context<AppEnv>) {
  if (!c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET) return failed(c);
  const next = safeNext(c.req.query("next"));
  const state = randomHex(16);
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  await c.env.KV.put(
    `gstate:${state}`,
    JSON.stringify({ verifier, next, expiresAt: Date.now() + STATE_TTL_SEC * 1000 }),
    { expirationTtl: STATE_TTL_SEC },
  );
  setCookie(c, stateCookie(c), state, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    maxAge: STATE_TTL_SEC,
    path: "/auth/google",
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(c),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  c.header("cache-control", "no-store");
  return c.redirect(url.toString(), 302);
}

type GoogleClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
};

function decodeIdToken(token: string): GoogleClaims | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (ch) => ch.charCodeAt(0))));
  } catch {
    return null;
  }
}

export async function googleCallback(c: Context<AppEnv>) {
  const state = c.req.query("state");
  const code = c.req.query("code");
  const cookie = getCookie(c, stateCookie(c));
  deleteCookie(c, stateCookie(c), { path: "/auth/google" });
  if (!state || !code || !cookie || cookie !== state || !/^[a-f0-9]{32}$/.test(state))
    return failed(c);
  const stored = await c.env.KV.get(`gstate:${state}`);
  if (!stored) return failed(c);
  await c.env.KV.delete(`gstate:${state}`);
  const { verifier, next, expiresAt } = JSON.parse(stored) as {
    verifier: string;
    next: string;
    expiresAt: number;
  };
  if (Date.now() >= expiresAt || !c.env.GOOGLE_CLIENT_ID || !c.env.GOOGLE_CLIENT_SECRET)
    return failed(c);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl(c),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  }).catch(() => null);
  if (!response?.ok) return failed(c);
  const tokens = (await response.json()) as { id_token?: string };
  // The ID token came straight from Google's token endpoint over TLS, authenticated with our
  // client secret, so its claims can be read without checking the signature again.
  const claims = tokens.id_token ? decodeIdToken(tokens.id_token) : null;
  if (
    !claims?.sub ||
    !claims.email ||
    claims.email_verified !== true ||
    claims.aud !== c.env.GOOGLE_CLIENT_ID ||
    !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss ?? "") ||
    (claims.exp ?? 0) * 1000 < Date.now()
  )
    return failed(c);
  await completeLogin(c, claims.email.trim().toLowerCase(), { sub: claims.sub });
  c.header("cache-control", "no-store");
  return c.redirect(`${c.env.ALLOWED_ORIGIN}${next}`, 302);
}
