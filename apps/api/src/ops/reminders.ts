import type { StoryId } from "@vzc/catalog";
import { filmMail } from "../services/film-mail.ts";
import { sendMail } from "../services/mail.ts";
import type { Bindings } from "../types.ts";

const DAY = 86_400_000;
const BATCH = 50;

/** Owner, 2026-10-15: one email the day before a film is deleted, so nobody loses it unawares. */
export async function remindBeforeDeletion(env: Bindings, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT s.id, s.story, s.expires_at, u.email, u.email_verified_at FROM stories s JOIN users u ON u.id=s.user_id WHERE s.status='done' AND s.reminded_at IS NULL AND s.expires_at>? AND s.expires_at<=? AND u.deleted_at IS NULL ORDER BY s.expires_at LIMIT ?",
  )
    .bind(now, now + DAY, BATCH)
    .all<{
      id: string;
      story: StoryId;
      expires_at: number;
      email: string;
      email_verified_at: number | null;
    }>();
  for (const row of results) {
    // Marked first: a mail that fails is not retried every hour (the done screen still says it).
    await env.DB.prepare("UPDATE stories SET reminded_at=? WHERE id=?").bind(now, row.id).run();
    await sendMail(
      env,
      await filmMail(env, {
        storyId: row.id,
        email: row.email,
        verified: row.email_verified_at !== null,
        expiresAt: row.expires_at,
        story: row.story,
        reminder: true,
      }),
    );
  }
  return results.length;
}
