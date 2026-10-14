import type { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

/** A finished job row with the given attempts (what JobRunner writes back to D1). */
export function row(
  h: Awaited<ReturnType<typeof setup>>,
  options: {
    kind?: string;
    capability?: string;
    createdAt?: number;
    attempts: { state: string; costUsd: number; finishedAt?: number; failKind?: string }[];
  },
) {
  const id = `J${Math.random().toString(36).slice(2, 12)}`;
  h.db
    .prepare(
      "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,attempts,charge,priority,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "g:x",
      "v",
      "ip",
      options.capability ?? "unblur.std",
      "auto",
      "auto",
      "std",
      "1",
      `in/${id}.jpg`,
      "{}",
      "{}",
      "succeeded",
      JSON.stringify(options.attempts.map((a, i) => ({ id: `a${i}`, finishedAt: NOON, ...a }))),
      JSON.stringify({ kind: options.kind ?? "quota" }),
      "free",
      `k-${id}`,
      options.createdAt ?? NOON,
      NOON + 86_400_000,
    );
  return id;
}
