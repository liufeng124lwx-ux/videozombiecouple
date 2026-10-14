import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  const listed = await bucket.list({ prefix });
  for (const object of listed.objects) await bucket.delete(object.key);
}

/** Spec 1.3 / 8.2: an expired job's upload and results go, and the row says so. Never samples/. */
export async function cleanupExpired(env: Bindings, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, input_key FROM jobs WHERE expires_at<=? AND status!='expired' ORDER BY expires_at LIMIT ?",
  )
    .bind(now, OPS.cleanupBatch)
    .all<{ id: string; input_key: string }>();
  let failed = 0;
  for (const job of results) {
    // One file that won't delete must not hold up everyone else's (the 24-hour promise, spec 7.4).
    try {
      if (!job.input_key.startsWith("samples/")) await env.BUCKET.delete(job.input_key);
      await deletePrefix(env.BUCKET, `out/${job.id}/`);
      await deletePrefix(env.BUCKET, `keep/${job.id}/`);
      await env.DB.prepare("UPDATE jobs SET status='expired' WHERE id=?").bind(job.id).run();
    } catch {
      failed++;
    }
  }
  if (failed > 0) throw new Error(`${failed} expired jobs could not be cleaned; the rest were`);
  return results.length;
}
