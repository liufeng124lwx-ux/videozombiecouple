import { RATE_LIMITS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { randomHex, sha256Hex } from "./session.ts";

/** Spec 5.1: codes live 10 minutes; links 15 minutes and work once. */
export const CODE_TTL_MS = 10 * 60_000;
export const LINK_TTL_MS = 15 * 60_000;

type StoredCode = { hash: string; attempts: number; expiresAt: number };
type StoredLink = { email: string; expiresAt: number };

const codeKey = async (email: string) => `code:login:${await sha256Hex(email)}`;
const digest = (email: string, code: string) => sha256Hex(`${email}:${code}`);
/** KV rejects TTLs under 60 seconds; the stored expiresAt is what actually ends a code. */
const ttlSec = (ms: number) => Math.max(60, Math.ceil(ms / 1000));

/** Uniform 000000–999999 (rejection sampling avoids modulo bias). */
export function sixDigits(): string {
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] ?? 0;
    if (value < 4_294_000_000) return String(value % 1_000_000).padStart(6, "0");
  }
}

/** A fresh code replaces any earlier one for this email. */
export async function issueCode(env: Bindings, email: string): Promise<string> {
  const code = sixDigits();
  const stored: StoredCode = {
    hash: await digest(email, code),
    attempts: 0,
    expiresAt: Date.now() + CODE_TTL_MS,
  };
  await env.KV.put(await codeKey(email), JSON.stringify(stored), {
    expirationTtl: ttlSec(CODE_TTL_MS),
  });
  return code;
}

/** A right code is used up; the fifth wrong guess deletes it, so it cannot be brute-forced. */
export async function checkCode(
  env: Bindings,
  email: string,
  code: string,
): Promise<"ok" | "invalid" | "expired"> {
  const key = await codeKey(email);
  const raw = await env.KV.get(key);
  if (!raw) return "expired";
  const stored = JSON.parse(raw) as StoredCode;
  if (Date.now() >= stored.expiresAt || stored.attempts >= RATE_LIMITS.codeMaxAttempts) {
    await env.KV.delete(key);
    return "expired";
  }
  if ((await digest(email, code)) !== stored.hash) {
    stored.attempts += 1;
    if (stored.attempts >= RATE_LIMITS.codeMaxAttempts) {
      await env.KV.delete(key);
      return "expired";
    }
    await env.KV.put(key, JSON.stringify(stored), {
      expirationTtl: ttlSec(stored.expiresAt - Date.now()),
    });
    return "invalid";
  }
  await env.KV.delete(key);
  return "ok";
}

/** A one-use sign-in link; the film emails use one that lasts as long as the film (ttlMs). */
export async function issueLinkToken(
  env: Bindings,
  email: string,
  ttlMs: number = LINK_TTL_MS,
): Promise<string> {
  const token = randomHex(32);
  const stored: StoredLink = { email, expiresAt: Date.now() + ttlMs };
  await env.KV.put(`login:${await sha256Hex(token)}`, JSON.stringify(stored), {
    expirationTtl: ttlSec(ttlMs),
  });
  return token;
}

/** The page redeems the token with a POST, so mail scanners that open links cannot use it up. */
export async function redeemLinkToken(env: Bindings, token: string): Promise<string | null> {
  const key = `login:${await sha256Hex(token)}`;
  const raw = await env.KV.get(key);
  if (!raw) return null;
  await env.KV.delete(key);
  const stored = JSON.parse(raw) as StoredLink;
  return Date.now() < stored.expiresAt ? stored.email : null;
}
