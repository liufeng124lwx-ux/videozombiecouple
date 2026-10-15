import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const listed = await bucket.list({ prefix });
  for (const object of listed.objects) await bucket.delete(object.key);
}

/**
 * A story's files go when it expires: 3 days after the film for an unverified buyer, 30 for a
 * verified account (owner, 2026-10-15). R2 lifecycle rules are the backstop: in/ 1 day, keep/ kf/
 * 3 days (photos never outlive that), shot/ out/ 31 days. Never assets/ or samples/.
 */
export async function cleanupExpired(env: Bindings, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id FROM stories WHERE expires_at<=? AND status NOT IN ('expired','previewing','rendering') ORDER BY expires_at LIMIT ?",
  )
    .bind(now, OPS.cleanupBatch)
    .all<{ id: string }>();
  let failed = 0;
  for (const story of results) {
    // One file that won't delete must not hold up everyone else's.
    try {
      for (const prefix of ["keep", "kf", "shot", "out"])
        await deletePrefix(env.BUCKET, `${prefix}/${story.id}/`);
      await env.STORY_RUNNER.get(env.STORY_RUNNER.idFromName(story.id)).purge();
      await env.DB.prepare("UPDATE stories SET status='expired' WHERE id=?").bind(story.id).run();
    } catch {
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} expired stories could not be cleaned; the rest were`);
  return results.length;
}
