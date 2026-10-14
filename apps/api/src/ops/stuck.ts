import { OPS, ROUTES } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { deliver, raise, type Send } from "./alerts.ts";

/** Twice the slowest a phase can legitimately take: every route's timeout in turn, plus composer retries. */
export function stuckAfterMs(phase: "previewing" | "rendering"): number {
  const sum = (capability: "keyframe" | "shot") =>
    ROUTES.filter((r) => r.capability === capability).reduce((t, r) => t + r.timeoutMs, 0);
  const composerMs = 30 * 60_000;
  const total =
    phase === "previewing"
      ? sum("keyframe") + composerMs
      : sum("keyframe") + sum("shot") + composerMs;
  return OPS.stuckFactor * total;
}

const mark = (id: string) => `stuck:${id}`;

/** Wake a stuck story; if it is still stuck next round, end it as TIMEOUT (holds go back). */
export async function checkStuck(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT id, status, COALESCE(rendered_at, created_at) AS since FROM stories WHERE status IN ('previewing','rendering') ORDER BY created_at LIMIT 200",
  ).all<{ id: string; status: "previewing" | "rendering"; since: number }>();
  for (const story of results) {
    if (now - story.since < stuckAfterMs(story.status)) continue;
    const runner = env.STORY_RUNNER.get(env.STORY_RUNNER.idFromName(story.id));
    if (!(await env.KV.get(mark(story.id)))) {
      await runner.poke();
      await env.KV.put(mark(story.id), String(now), { expirationTtl: 86_400 });
      continue;
    }
    const outcome = await runner.giveUp();
    if (outcome === "missing") {
      await env.DB.prepare(
        "UPDATE stories SET status=?, error_code='TIMEOUT', finished_at=? WHERE id=? AND status IN ('previewing','rendering')",
      )
        .bind(story.status === "previewing" ? "preview_failed" : "failed", now, story.id)
        .run();
      await raise(
        env,
        {
          key: `stuck:${story.id}`,
          title: "Stuck story had no runner",
          detail: `${story.id} was marked failed; check its holds`,
        },
        now,
        send,
      );
    }
    await env.KV.delete(mark(story.id));
  }
}
