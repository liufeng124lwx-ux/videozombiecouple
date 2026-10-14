import { OPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** Spec §8: after 90 days a story keeps its numbers but not who made it, or their names. */
export async function anonymizeOld(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare(
    // No owner either; the idempotency key is unique per owner, so it becomes the id.
    "UPDATE stories SET owner='anon', user_id='anon', idempotency_key=id, visitor_hash='anon', ip_hash='anon', fp_hash=NULL, names=NULL, date=NULL WHERE created_at<? AND ip_hash!='anon'",
  )
    .bind(now - OPS.anonymizeAfterDays * 86_400_000)
    .run();
}
