import type { Bindings } from "../types.ts";
import { endAllSessions, sha256Hex } from "./session.ts";

/**
 * Spec 5.5: files go at once, jobs stay only as anonymous statistics, credits are forfeited, the
 * email becomes a hash so it can sign up again as a new account, and every session ends.
 * Orders and subscriptions are kept for tax but no longer point at a person.
 *
 * Order matters: the account is closed and signed out first (so a later failure still leaves it
 * unusable and the call can be repeated), running jobs are stopped before their files are removed
 * (so no result is written afterwards), and credits are forfeited last (after the stopped jobs
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

  const { results: jobs } = await env.DB.prepare(
    "SELECT id, input_key, status FROM jobs WHERE owner=?",
  )
    .bind(owner)
    .all<{ id: string; input_key: string; status: string }>();
  for (const job of jobs)
    if (["created", "queued", "submitted"].includes(job.status))
      await env.JOB_RUNNER.get(env.JOB_RUNNER.idFromName(job.id)).cancel();
  for (const job of jobs) {
    await env.BUCKET.delete(job.input_key);
    for (const prefix of [`out/${job.id}/`, `keep/${job.id}/`]) {
      const listed = await env.BUCKET.list({ prefix });
      for (const object of listed.objects) await env.BUCKET.delete(object.key);
    }
  }
  // The idempotency key is cleared too: (owner, key) is unique and every deleted job shares owner.
  await env.DB.prepare(
    "UPDATE jobs SET owner='deleted', visitor_hash='', fp_hash=NULL, ip_hash='', idempotency_key=id WHERE owner=?",
  )
    .bind(owner)
    .run();
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET user_id=NULL WHERE user_id=?").bind(userId),
    env.DB.prepare("UPDATE subscriptions SET user_id=NULL WHERE user_id=?").bind(userId),
  ]);
  await env.WALLET.get(env.WALLET.idFromName(userId)).forfeitAll(userId, "account_deleted");
}
