import type { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

/**
 * A finished story row with one step holding the given attempts (what StoryRunner writes back to
 * D1). `kind` says who paid: "quota" is the free preview phase, "credits" the paid video phase.
 */
export function row(
  h: Awaited<ReturnType<typeof setup>>,
  options: {
    kind?: "quota" | "credits";
    capability?: "keyframe" | "shot";
    createdAt?: number;
    attempts: { state: string; costUsd: number; finishedAt?: number; failKind?: string }[];
  },
) {
  const id = `S${Math.random().toString(36).slice(2, 12)}`;
  const phase = options.kind === "credits" ? "video" : "preview";
  const capability = options.capability ?? (phase === "video" ? "shot" : "keyframe");
  const steps = [
    {
      id: `${capability === "shot" ? "shot" : "kf"}:1`,
      phase,
      capability,
      state: "succeeded",
      error: null,
      attempts: options.attempts.map((a) => ({
        model: "m",
        taskId: null,
        costEstimated: false,
        costTimeMs: null,
        failKind: null,
        finishedAt: NOON,
        ...a,
      })),
    },
  ];
  h.db
    .prepare(
      "INSERT INTO stories(id,owner,user_id,visitor_hash,ip_hash,kind,scene,prompt_version,survivor_key,infected_key,status,steps,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "u:x",
      "x",
      "v",
      "ip",
      "human",
      "cabin-wheat",
      "1",
      `keep/${id}/survivor.jpg`,
      `keep/${id}/infected.jpg`,
      phase === "video" ? "done" : "preview_ready",
      JSON.stringify(steps),
      `k-${id}`,
      options.createdAt ?? NOON,
      NOON + 86_400_000,
    );
  return id;
}
