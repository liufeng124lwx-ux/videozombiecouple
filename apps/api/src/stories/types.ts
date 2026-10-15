import type { CapabilityId, FrameId, Kind, SceneId } from "@vzc/catalog";
import type { ErrorCode, StoryStatus } from "@vzc/contracts";
import type { FailKind, Route } from "@vzc/providers";
import type { ChargeHold } from "../services/settle.ts";

/** Everything the runner needs; written once by POST /v1/stories. */
export type StorySpec = {
  id: string;
  owner: string;
  /** null while a guest owns the story; set when the guest buys (and gets an account). */
  userId: string | null;
  kind: Kind;
  scene: SceneId;
  names: string | null;
  date: string | null;
  /** keep/<id>/survivor.jpg and keep/<id>/infected.jpg */
  survivorKey: string;
  infectedKey: string;
  createdAt: number;
};

export type StepKind = "kie" | "score" | "compose";
export type Phase = "preview" | "video";

/** waiting: deps not met or not started · queued/submitting/pending: a kie attempt is running. */
export type StepState =
  | "waiting"
  | "queued"
  | "submitting"
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export type AttemptState =
  | "queued"
  | "submitting"
  | "pending"
  | "succeeded"
  | "failed"
  | "abandoned";

export type AttemptRecord = {
  id: string;
  /** Snapshot of the route when planned; admin edits apply to later attempts. */
  route: Route;
  state: AttemptState;
  queuePosition: number | null;
  taskId: string | null;
  submittedAt: number | null;
  deadline: number | null;
  nextPollAt: number | null;
  finishedAt: number | null;
  failKind: FailKind | null;
  failMsg: string | null;
  costUsd: number | null;
  /** The cost was not reported (abandoned call), so the route's estimate was booked. */
  costEstimated?: boolean;
  costTimeMs: number | null;
};

export type StepRecord = {
  id: string;
  kind: StepKind;
  phase: Phase;
  capability?: CapabilityId;
  deps: string[];
  state: StepState;
  attempts: AttemptRecord[];
  /** Routes not tried yet, in order (kie steps). */
  fallbacks: Route[];
  outputKey: string | null;
  /** Composer calls that threw; drives the retry backoff. */
  failures: number;
  nextRunAt: number | null;
  error: string | null;
  /** Set when the step failed: the reason the story ends with. */
  failKind: FailKind | null;
};

export type StoryState = {
  spec: StorySpec;
  status: StoryStatus;
  steps: Record<string, StepRecord>;
  /** Best keyframe per frame after scoring (R2 keys). */
  picks: Partial<Record<FrameId, string>>;
  previewCharge: ChargeHold | null;
  videoCharge: ChargeHold | null;
  previewSettled: boolean;
  videoSettled: boolean;
  recomposeLeft: number;
  /** Free remakes left (owner, 2026-10-15); absent on stories made before the change. */
  remakeLeft?: number;
  output: { videoKey: string; posterKey: string } | null;
  errorCode: ErrorCode | null;
  finishedAt: number | null;
  /** Last summary written to D1, to skip identical writes. */
  syncedSig: string;
  /** Settlement calls that threw; drives the retry backoff. */
  settleFailures?: number;
  /** Paid render attempts started; each holds credits under its own reservation id. */
  videoAttempts?: number;
  /** The "your film is ready" email went out (once per story). */
  notified?: boolean;
};
