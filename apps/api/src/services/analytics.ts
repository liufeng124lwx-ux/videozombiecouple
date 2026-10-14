import type { Bindings } from "../types.ts";

export type AttemptRow = {
  capability: string;
  model: string;
  outcome: "succeeded" | "failed" | "abandoned";
  failKind: string | null;
  /** Free preview work (true) or paid video work (false). */
  free: boolean;
  costUsd: number | null;
  durationMs: number | null;
};

/** Spec 1.3 / 8.4: one data point per model call; the cost dashboard queries these. */
export function recordAttempt(env: Bindings, row: AttemptRow): void {
  env.ANALYTICS?.writeDataPoint({
    indexes: [row.capability],
    blobs: [row.capability, row.model, row.outcome, row.failKind ?? "", row.free ? "free" : "paid"],
    doubles: [row.costUsd ?? 0, row.durationMs ?? 0],
  });
}
