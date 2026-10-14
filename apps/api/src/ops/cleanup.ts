import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const listed = await bucket.list({ prefix });
  for (const object of listed.objects) await bucket.delete(object.key);
}

/**
 * Spec §3.4: a story's files go when it expires (R2 lifecycle rules are the backstop: in/ 1 day,
 * keep/ kf/ 3 days, shot/ out/ 15 days so a late title change still has its shots), and the row says so. Never assets/ or samples/.
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
      await env.DB.prepare("UPDATE stories SET status='expired' WHERE id=?").bind(story.id).run();
    } catch {
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} expired stories could not be cleaned; the rest were`);
  return results.length;
}
