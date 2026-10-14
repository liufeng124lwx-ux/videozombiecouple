import type { Bindings } from "../types.ts";

/** Spec 8.1: who did what to what, with the values before and after. */
export async function audit(
  env: Bindings,
  actor: string,
  action: string,
  target: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO admin_audit(actor,action,target,before,after,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(
      actor,
      action,
      target,
      JSON.stringify(before ?? null),
      JSON.stringify(after ?? null),
      Date.now(),
    )
    .run();
}
