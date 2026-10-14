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
/** A call finishes at most this long after its job was created (a free retry near the 24h expiry can run past a day). */
const MAX_JOB_SPAN_MS = 2 * 86_400_000;
export const startOfUtcDay = (t: number) => t - (t % 86_400_000);

const SCOPE_SQL: Record<SpendScope, string> = {
  all: "",
  free: "AND json_extract(jobs.charge, '$.kind') != 'credits'",
  paid: "AND json_extract(jobs.charge, '$.kind') = 'credits'",
};

/** Every model call that finished in [from, to) (JobRunner writes them to jobs.attempts). */
export async function attemptsBetween(
  env: Bindings,
  from: number,
  to: number = FOREVER,
  scope: SpendScope = "all",
): Promise<AttemptStat[]> {
  const { results } = await env.DB.prepare(
    `SELECT capability, state, costUsd, finishedAt, failKind FROM (
       SELECT jobs.capability AS capability,
              json_extract(a.value, '$.state') AS state,
              json_extract(a.value, '$.failKind') AS failKind,
              COALESCE(json_extract(a.value, '$.costUsd'), 0) AS costUsd,
              COALESCE(json_extract(a.value, '$.finishedAt'), jobs.finished_at, jobs.created_at) AS finishedAt
         FROM jobs, json_each(jobs.attempts) AS a
        WHERE jobs.created_at >= ? ${SCOPE_SQL[scope]})
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
