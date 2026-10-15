import { RETENTION } from "@vzc/catalog";
import type { Context } from "hono";
import type { AppEnv, Bindings } from "../types.ts";

/**
 * On sign-in (or the guest sign-up before checkout), the stories this browser started as a guest
 * move to the account, in D1 and in each story's runner, so the account can pay for them.
 */
export async function mergeGuest(c: Context<AppEnv>, userId: string): Promise<void> {
  const guest = c.get("guestOwner");
  const { results } = await c.env.DB.prepare(
    "SELECT id FROM stories WHERE owner=? AND status!='expired'",
  )
    .bind(guest)
    .all<{ id: string }>();
  if (results.length === 0) return;
  await c.env.DB.prepare("UPDATE stories SET owner=?, user_id=? WHERE owner=?")
    .bind(`u:${userId}`, userId, guest)
    .run();
  for (const story of results)
    await c.env.STORY_RUNNER.get(c.env.STORY_RUNNER.idFromName(story.id)).adopt(
      `u:${userId}`,
      userId,
    );
}

/**
 * The owner proved their email (code, link or Google): their films are kept 30 days from when they
 * were finished instead of 3, including films already made as an unverified buyer.
 */
export async function keepFilmsLonger(env: Bindings, userId: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE stories SET retention='member', expires_at=CASE WHEN status='done' AND finished_at IS NOT NULL THEN finished_at+? ELSE expires_at END WHERE user_id=? AND retention='guest'",
  )
    .bind(RETENTION.memberFilmDays * 86_400_000, userId)
    .run();
}
