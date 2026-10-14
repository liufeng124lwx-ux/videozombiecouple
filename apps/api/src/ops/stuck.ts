import { type CapabilityId, OPS, ROUTES } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, type Send } from "./alerts.ts";

/** Spec 8.2: twice the slowest a job can legitimately take (every route's timeout, in turn). */
export function stuckAfterMs(capability: CapabilityId): number {
  const total = ROUTES.filter((r) => r.capability === capability).reduce(
    (sum, r) => sum + r.timeoutMs,
    0,
  );
  return OPS.stuckFactor * total;
}

const mark = (id: string) => `stuck:${id}`;

/** Spec 8.2: wake a stuck job; if it is still stuck next round, end it as TIMEOUT. */
export async function checkStuck(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, capability, created_at FROM jobs WHERE status IN ('created','queued','submitted') ORDER BY created_at LIMIT 200",
  ).all<{ id: string; capability: CapabilityId; created_at: number }>();
  for (const job of results) {
    if (now - job.created_at < stuckAfterMs(job.capability)) continue;
    const runner = env.JOB_RUNNER.get(env.JOB_RUNNER.idFromName(job.id));
    if (!(await env.KV.get(mark(job.id)))) {
      await runner.poke();
      await env.KV.put(mark(job.id), String(now), { expirationTtl: 86_400 });
      continue;
    }
    const outcome = await runner.giveUp();
    if (outcome === "missing") {
      await env.DB.prepare(
        "UPDATE jobs SET status='failed', error_code='TIMEOUT', finished_at=? WHERE id=? AND status IN ('created','queued','submitted')",
      )
        .bind(now, job.id)
        .run();
      await raise(
        env,
        {
          key: `stuck:${job.id}`,
          title: "Stuck job had no runner",
          detail: `${job.id} was marked failed; check its charge`,
        },
        now,
        send,
      );
    }
    await env.KV.delete(mark(job.id));
  }
}
