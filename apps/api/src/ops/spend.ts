import type { Bindings } from "../types.ts";

export type AttemptStat = {
  capability: string;
  state: string;
  costUsd: number;
  finishedAt: number | null;
  failKind: string | null;
};
export type SpendScope = "all" | "free" | "paid";

const FOREVER = Number.MAX_SAFE_INTEGER;
/** A call finishes at most this long after its story was created (a video can be ordered until the photos expire). */
const MAX_JOB_SPAN_MS = 4 * 86_400_000;
export const startOfUtcDay = (t: number) => t - (t % 86_400_000);

const SCOPE_SQL: Record<SpendScope, string> = {
  all: "",
  free: "AND json_extract(s.value, '$.phase') = 'preview'",
  paid: "AND json_extract(s.value, '$.phase') = 'video'",
};

/** Every model call that finished in [from, to) (StoryRunner writes them to stories.steps). */
export async function attemptsBetween(
  env: Bindings,
  from: number,
  to: number = FOREVER,
  scope: SpendScope = "all",
): Promise<AttemptStat[]> {
  const { results } = await env.DB.prepare(
    `SELECT capability, state, costUsd, finishedAt, failKind FROM (
       SELECT json_extract(s.value, '$.capability') AS capability,
              json_extract(a.value, '$.state') AS state,
              json_extract(a.value, '$.failKind') AS failKind,
              COALESCE(json_extract(a.value, '$.costUsd'), 0) AS costUsd,
              COALESCE(json_extract(a.value, '$.finishedAt'), stories.finished_at, stories.created_at) AS finishedAt
         FROM stories, json_each(stories.steps) AS s, json_each(json_extract(s.value, '$.attempts')) AS a
        WHERE stories.created_at >= ? ${SCOPE_SQL[scope]})
      WHERE finishedAt >= ? AND finishedAt < ?`,
  )
    .bind(Math.max(0, from - MAX_JOB_SPAN_MS), from, to)
    .all<AttemptStat>();
  return results;
}

/** What the calls that finished in [from, to) cost. */
export async function spendBetween(
  env: Bindings,
  from: number,
  to: number = FOREVER,
  scope: SpendScope = "all",
): Promise<number> {
  const rows = await attemptsBetween(env, from, to, scope);
  return rows.reduce((sum, r) => sum + Number(r.costUsd), 0);
}
