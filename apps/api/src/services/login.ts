import { isSameSitePath } from "@vzc/contracts";
import type { Context } from "hono";
import type { AppEnv } from "../types.ts";
import { grantSignupBonus } from "./bonus.ts";
import { mergeGuest } from "./merge.ts";
import { startSession } from "./session.ts";
import { createUser, userByEmail, userByGoogleSub } from "./users.ts";

export type LoginResult = { userId: string; created: boolean; bonus: boolean };

/** Only same-site paths, so a sign-in link cannot bounce to another domain. */
export function safeNext(value: string | undefined): string {
  return value && isSameSitePath(value) ? value : "/account";
}

/**
 * Where every sign-in lands (code, link, Google): find or create the verified account and start a
 * session. Task 8 adds the sign-up bonus and Task 9 the guest merge here.
 */
export async function completeLogin(
  c: Context<AppEnv>,
  email: string,
  google?: { sub: string },
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
  await startSession(c, userId);
  await mergeGuest(c, userId);
  const bonus = created ? await grantSignupBonus(c, userId) : false;
  return { userId, created, bonus };
}
