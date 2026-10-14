import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** Spec 8.2 / 7.4: after 90 days a job keeps its numbers but not who or where it came from. */
export async function anonymizeOld(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare(
    // Spec 4.6: no owner either; the idempotency key is unique per owner, so it becomes the id.
    "UPDATE jobs SET owner='anon', idempotency_key=id, visitor_hash='anon', ip_hash='anon', fp_hash=NULL, diagnosis='{}' WHERE created_at<? AND ip_hash!='anon'",
  )
    .bind(now - OPS.anonymizeAfterDays * 86_400_000)
    .run();
}
