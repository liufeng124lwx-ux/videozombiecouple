import { isSameSitePath } from "@vzc/contracts";
import type { Context } from "hono";
import type { AppEnv } from "../types.ts";
import { grantSignupBonus } from "./bonus.ts";
import { keepFilmsLonger, mergeGuest } from "./merge.ts";
import { endAllSessions, startSession } from "./session.ts";
import { createUser, userByEmail, userByGoogleSub } from "./users.ts";

export type LoginResult = { userId: string; created: boolean; bonus: boolean };

/** Only same-site paths, so a sign-in link cannot bounce to another domain. */
export function safeNext(value: string | undefined): string {
  return value && isSameSitePath(value) ? value : "/account";
}

/**
 * Where every sign-in lands (code, link, Google): find or create the account, mark the email
 * verified, start a session, bring this browser's guest stories along and keep films 30 days.
 */
export async function completeLogin(
  c: Context<AppEnv>,
  email: string,
  google?: { sub: string },
  { merge = true }: { merge?: boolean } = {},
): Promise<LoginResult> {
  const db = c.env.DB;
  const existing =
    (google ? await userByGoogleSub(db, google.sub) : null) ?? (await userByEmail(db, email));
  let userId: string;
  let created = false;
  if (existing) {
    userId = existing.id;
    if (google && !existing.googleSub)
      await db
        .prepare("UPDATE users SET google_sub=? WHERE id=? AND google_sub IS NULL")
        .bind(google.sub, userId)
        .run();
  } else {
    ({ id: userId, created } = await createUser(
      db,
      email,
      google ? { googleSub: google.sub } : {},
    ));
  }
  // Every way in here proves the email: an account made at a guest checkout becomes verified.
  // Anyone can type an address at a guest checkout, so whoever did may still hold a session (or a
  // password) on it: the owner's first proof of the email ends both before the owner moves in.
  const proven = await db
    .prepare(
      "UPDATE users SET email_verified_at=?, password_hash=NULL WHERE id=? AND email_verified_at IS NULL",
    )
    .bind(Date.now(), userId)
    .run();
  if (proven.meta.changes > 0) await endAllSessions(db, userId);
  await startSession(c, userId);
  if (merge) await mergeGuest(c, userId);
  await keepFilmsLonger(c.env, userId);
  const bonus = created ? await grantSignupBonus(c, userId) : false;
  return { userId, created, bonus };
}

/**
 * Buying without signing in (owner, 2026-10-15): a NEW email becomes an unverified account and the
 * browser is signed into it, so the checkout and the film belong to it. An email that already has
 * an account must sign in with a code instead: typing someone's address never opens their account.
 */
export async function guestSignUp(
  c: Context<AppEnv>,
  email: string,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  if (await userByEmail(c.env.DB, email)) return { ok: false };
  const { id, created } = await createUser(c.env.DB, email, { verified: false });
  // Lost a race with another sign-up for the same email: that account is not ours to enter.
  if (!created) return { ok: false };
  await startSession(c, id);
  await mergeGuest(c, id);
  return { ok: true, userId: id };
}
