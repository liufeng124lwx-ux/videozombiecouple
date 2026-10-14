import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppEnv, Bindings } from "../types.ts";

export const SESSION_TTL_MS = 90 * 86_400_000;

// Staging and production share the cookie domain, so staging gets its own names.
const staging = (env: Bindings) => env.ALLOWED_ORIGIN.includes("staging");
export const sessionCookie = (env: Bindings) => (staging(env) ? "upx_sess_stg" : "upx_sess");
/** Readable by pages so the header can say "Account" without an API call; holds no secret. */
export const hintCookie = (env: Bindings) => (staging(env) ? "upx_in_stg" : "upx_in");

export function randomHex(bytes = 16): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const cookieOptions = (env: Bindings, httpOnly: boolean) =>
  ({
    domain: env.COOKIE_DOMAIN || undefined,
    httpOnly,
    secure: true,
    sameSite: "Lax",
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
  }) as const;

/** Only the hash of the session id is stored, so a D1 leak does not leak sessions. */
export async function startSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const id = randomHex(32);
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions(id_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
  )
    .bind(await sha256Hex(id), userId, now, now + SESSION_TTL_MS)
    .run();
  setCookie(c, sessionCookie(c.env), id, cookieOptions(c.env, true));
  setCookie(c, hintCookie(c.env), "1", cookieOptions(c.env, false));
  c.set("userId", userId);
  c.set("owner", `u:${userId}`);
}

export async function sessionUserId(c: Context<AppEnv>): Promise<string | null> {
  const id = getCookie(c, sessionCookie(c.env));
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const row = await c.env.DB.prepare(
    "SELECT s.user_id AS user_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash=? AND s.expires_at>? AND u.deleted_at IS NULL",
  )
    .bind(await sha256Hex(id), Date.now())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const id = getCookie(c, sessionCookie(c.env));
  if (id && /^[a-f0-9]{64}$/.test(id))
    await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash=?")
      .bind(await sha256Hex(id))
      .run();
  const scope = { domain: c.env.COOKIE_DOMAIN || undefined, path: "/" };
  deleteCookie(c, sessionCookie(c.env), scope);
  deleteCookie(c, hintCookie(c.env), scope);
  c.set("userId", null);
  c.set("owner", c.get("guestOwner"));
}

export async function endAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(userId).run();
}
