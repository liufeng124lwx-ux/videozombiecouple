import type { CapabilityId, ModeId, TierId } from "@vzc/catalog";
import type { ErrorCode, GuardMetrics, JobState } from "@vzc/contracts";
import type { FailKind, Route } from "@vzc/providers";
import type { ChargeHold } from "../services/settle.ts";

/** Everything the runner needs to process a job; written once by POST /v1/jobs. */
export type JobSpec = {
  id: string;
  owner: string;
  capability: CapabilityId;
  mode: ModeId;
  prompt: string;
  promptVersion: string;
  /** One of the capability's pad aspects; the browser padded the photo to it (spec 3.1). */
  aspect: string;
  inputKey: string;
  priority: "paid" | "free";
  charge: ChargeHold;
  createdAt: number;
  expiresAt: number;
};

export type AttemptRole = "primary" | "fallback" | "retry";

/** queued: waiting for a Dispatcher slot · submitting: slot granted, kie call not confirmed yet. */
export type AttemptStatus =
  | "queued"
  | "submitting"
  | "pending"
  | "succeeded"
  | "failed"
  | "abandoned";

export type AttemptRecord = {
  id: string;
  /** Snapshot of the route when the attempt was planned; admin edits apply to later attempts. */
  route: Route;
  role: AttemptRole;
  freeRetry: boolean;
  state: AttemptStatus;
  queuePosition: number | null;
  taskId: string | null;
  submittedAt: number | null;
  deadline: number | null;
  nextPollAt: number | null;
  finishedAt: number | null;
  failKind: FailKind | null;
  failMsg: string | null;
  costUsd: number | null;
  /** The cost was not reported (abandoned call), so the route's estimate was booked (cost guardrails spec 5). */
  costEstimated?: boolean;
  costTimeMs: number | null;
  outputKey: string | null;
  /** Fidelity check numbers the browser sent when it asked for a free retry of this result. */
  guard: GuardMetrics | null;
};

export type RunnerState = {
  job: JobSpec;
  status: JobState;
  attempts: AttemptRecord[];
  /** Fallback routes not tried yet, in order. */
  fallbacks: Route[];
  fallbacksUsed: number;
  chargedTier: TierId | null;
  /** The hold has been committed or released; never settle twice. */
  settled: boolean;
  errorCode: ErrorCode | null;
  retry: { reason: "guard" | "thumbs_down"; feedback: string | null; at: number } | null;
  finishedAt: number | null;
  /** Last attempts summary written to D1, to skip identical writes. */
  syncedSig: string;
  /** Settlement calls that threw; drives the retry backoff. */
  settleFailures: number;
};

export type RunnerAttemptView = {
  id: string;
  label: string;
  model: string;
  role: AttemptRole;
  freeRetry: boolean;
  state: AttemptStatus;
  outputKey: string | null;
  failKind: FailKind | null;
};

export type RunnerView = {
  job: JobSpec;
  status: JobState;
  queuePosition: number | null;
  etaMs: number | null;
  attempts: RunnerAttemptView[];
  chargedTier: TierId | null;
  errorCode: ErrorCode | null;
  finishedAt: number | null;
};
