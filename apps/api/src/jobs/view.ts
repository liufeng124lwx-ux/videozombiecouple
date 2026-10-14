import { TIERS } from "@vzc/catalog";
import type { AttemptState, ChargeView, JobView } from "@vzc/contracts";
import { presign } from "../services/r2-presign.ts";
import type { Bindings } from "../types.ts";
import type { AttemptStatus, RunnerView } from "./types.ts";

/** Input and result links last an hour; the page asks again on every poll (spec 4.1). */
const LINK_SEC = 3_600;

const ATTEMPT_STATE: Record<AttemptStatus, AttemptState> = {
  queued: "pending",
  submitting: "pending",
  pending: "pending",
  succeeded: "succeeded",
  failed: "failed",
  abandoned: "abandoned",
};

function chargeView(view: RunnerView): ChargeView {
  const charge = view.job.charge;
  if (charge.kind !== "credits") return { kind: charge.kind, credits: 0 };
  if (view.chargedTier) return { kind: "credits", credits: TIERS[view.chargedTier].credits };
  return { kind: "credits", credits: view.status === "failed" ? 0 : charge.reserved };
}

export async function toJobView(env: Bindings, view: RunnerView): Promise<JobView> {
  const expired = Date.now() >= view.job.expiresAt;
  const link = async (key: string | null) =>
    key && !expired ? presign(env, key, "GET", LINK_SEC) : null;
  return {
    id: view.job.id,
    capability: view.job.capability,
    mode: view.job.mode,
    state: expired ? "expired" : view.status,
    queuePosition: view.queuePosition,
    etaMs: view.etaMs,
    inputUrl: await link(view.job.inputKey),
    attempts: await Promise.all(
      view.attempts.map(async (attempt) => ({
        id: attempt.id,
        label: attempt.label,
        state: ATTEMPT_STATE[attempt.state],
        resultUrl: await link(attempt.outputKey),
        freeRetry: attempt.freeRetry,
      })),
    ),
    charge: chargeView(view),
    errorCode: view.errorCode,
    expiresAt: view.job.expiresAt,
  };
}
