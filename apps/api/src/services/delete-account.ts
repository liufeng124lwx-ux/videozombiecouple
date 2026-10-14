import type { Bindings } from "../types.ts";
import { endAllSessions, sha256Hex } from "./session.ts";

/**
 * Spec 5.5: files go at once, stories stay only as anonymous statistics, credits are forfeited, the
 * email becomes a hash so it can sign up again as a new account, and every session ends.
 * Orders and subscriptions are kept for tax but no longer point at a person.
 *
 * Order matters: the account is closed and signed out first (so a later failure still leaves it
 * unusable and the call can be repeated), running stories are stopped before their files are removed
 * (so no result is written afterwards), and credits are forfeited last (after the stopped stories
 * gave their holds back).
 */
export async function deleteAccount(env: Bindings, userId: string): Promise<void> {
  const owner = `u:${userId}`;
  const row = await env.DB.prepare("SELECT email FROM users WHERE id=?")
    .bind(userId)
    .first<{ email: string }>();
  await env.DB.prepare(
    "UPDATE users SET email=?, password_hash=NULL, google_sub=NULL, deleted_at=COALESCE(deleted_at, ?) WHERE id=?",
  )
    .bind(`deleted:${await sha256Hex(`${row?.email ?? ""}:${userId}`)}`, Date.now(), userId)
    .run();
  await endAllSessions(env.DB, userId);

  const { results: stories } = await env.DB.prepare("SELECT id, status FROM stories WHERE owner=?")
    .bind(owner)
    .all<{ id: string; status: string }>();
  for (const story of stories)
    if (["previewing", "rendering"].includes(story.status))
      await env.STORY_RUNNER.get(env.STORY_RUNNER.idFromName(story.id)).cancel();
  for (const story of stories)
    for (const prefix of ["keep", "kf", "shot", "out"]) {
      const listed = await env.BUCKET.list({ prefix: `${prefix}/${story.id}/` });
      for (const object of listed.objects) await env.BUCKET.delete(object.key);
    }
  // The idempotency key is cleared too: (owner, key) is unique and every deleted story shares owner.
  await env.DB.prepare(
    "UPDATE stories SET owner='deleted', user_id='deleted', visitor_hash='', fp_hash=NULL, ip_hash='', names=NULL, date=NULL, idempotency_key=id WHERE owner=?",
  )
    .bind(owner)
    .run();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET user_id=NULL WHERE user_id=?").bind(userId),
    env.DB.prepare("UPDATE subscriptions SET user_id=NULL WHERE user_id=?").bind(userId),
  ]);
  await env.WALLET.get(env.WALLET.idFromName(userId)).forfeitAll(userId, "account_deleted");
}
