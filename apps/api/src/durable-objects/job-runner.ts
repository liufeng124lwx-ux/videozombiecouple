import { DurableObject } from "cloudflare:workers";
import { CAPABILITIES, TIERS, type TierId } from "@vzc/catalog";
import type { ErrorCode, GuardMetrics } from "@vzc/contracts";
import {
  chargeTier,
  type FailKind,
  ProviderError,
  planRoutes,
  type Route,
  type StatusResult,
} from "@vzc/providers";
import { retryRoute } from "../jobs/retry-route.ts";
import type {
  AttemptRecord,
  AttemptRole,
  JobSpec,
  RunnerState,
  RunnerView,
} from "../jobs/types.ts";
import { pauseForKieCap } from "../ops/kie-cap.ts";
import { recordAttempt } from "../services/analytics.ts";
import { callbackToken } from "../services/crypto.ts";
import { type ProviderKit, providerKit } from "../services/provider-kit.ts";
import { presign } from "../services/r2-presign.ts";
import { loadRoutes } from "../services/routes-store.ts";
import { settle } from "../services/settle.ts";
import type { Bindings } from "../types.ts";

const QUEUE_POLL_MS = 2_000;
const STATUS_POLL_MS = 5_000;
/** kie reads the input through a link this long-lived (spec 3.2 step 3). */
const INPUT_URL_SEC = 3_600;
/** Spec 4.3: one failure switch per job; for Pro it is the backstop after both candidates. */
const MAX_FALLBACKS = 1;
/** Settlement retries back off from 30 seconds to 15 minutes and never stop. */
const SETTLE_RETRY_MS = 30_000;
const SETTLE_RETRY_MAX_MS = 15 * 60_000;
/** Only these say something about a model's health; a rejected photo does not. */
const BREAKER_KINDS: readonly FailKind[] = ["provider_error", "timeout"];

/** Spec 3.6: the code a failed job ends with, from its last failure. */
const FAIL_CODE: Record<FailKind, ErrorCode> = {
  content_rejected: "CONTENT_REJECTED",
  timeout: "TIMEOUT",
  provider_error: "PROVIDER_DOWN",
  invalid: "FILE_UNSUPPORTED",
  rate_limited: "PROVIDER_DOWN",
  key_daily_cap: "PAUSED",
};

const isActive = (attempt: AttemptRecord) =>
  attempt.state === "queued" || attempt.state === "submitting" || attempt.state === "pending";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

type RetryRequest = {
  attemptId: string;
  reason: "guard" | "thumbs_down";
  guard?: GuardMetrics;
  feedback?: string;
};

export type RetryOutcome =
  | { ok: true }
  | { ok: false; reason: "not_found" | "used" | "not_done" | "unavailable" };

export function newAttempt(state: RunnerState, route: Route, role: AttemptRole): AttemptRecord {
  return {
    id: `a${state.attempts.length + 1}`,
    route,
    role,
    freeRetry: role === "retry",
    state: "queued",
    queuePosition: null,
    taskId: null,
    submittedAt: null,
    deadline: null,
    nextPollAt: null,
    finishedAt: null,
    failKind: null,
    failMsg: null,
    costUsd: null,
    costTimeMs: null,
    outputKey: null,
    guard: null,
  };
}

/**
 * One object per job (spec 4.1). It asks the pool's Dispatcher for a slot per attempt, submits and
 * polls through the provider adapter, stores results in R2, switches to a fallback (spec 4.3) and
 * settles the charge once every attempt has ended. All waiting is done with the DO alarm.
 */
export class JobRunner extends DurableObject<Bindings> {
  #state: RunnerState | null | undefined;
  #kit: ProviderKit | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs entry points one at a time. Input gates only cover storage, so without this a retry, a
   * kie callback and the alarm could interleave across their fetch / D1 / RPC awaits.
   */
  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  start(job: JobSpec): Promise<RunnerView> {
    return this.#serial(() => this.#start(job));
  }

  async #start(job: JobSpec): Promise<RunnerView> {
    const existing = await this.#load();
    if (existing) return this.#view(existing);
    const state: RunnerState = {
      job,
      status: "created",
      attempts: [],
      fallbacks: [],
      fallbacksUsed: 0,
      chargedTier: null,
      settled: false,
      errorCode: null,
      retry: null,
      finishedAt: null,
      syncedSig: "",
      settleFailures: 0,
    };
    this.#state = state;
    // Persist before any I/O: if planning or the first slot request fails, the alarm resumes it.
    await this.#save(state);
    await this.#tick(state);
    return this.#view(state);
  }

  async view(): Promise<RunnerView | null> {
    const state = await this.#load();
    return state ? this.#view(state) : null;
  }

  /**
   * Spec 3.7 / 4.1: one free retry per job, appended as a new version; earlier results stay and the
   * charge does not change. The caller has already checked ownership and the per-identity limits.
   */
  retry(request: RetryRequest): Promise<RetryOutcome> {
    return this.#serial(() => this.#retry(request));
  }

  async #retry(request: RetryRequest): Promise<RetryOutcome> {
    const state = await this.#load();
    if (!state) return { ok: false, reason: "not_found" };
    if (state.attempts.some((a) => a.freeRetry)) return { ok: false, reason: "used" };
    if (state.status !== "succeeded" || !state.settled) return { ok: false, reason: "not_done" };
    const target = state.attempts.find(
      (a) => a.id === request.attemptId && a.state === "succeeded",
    );
    if (!target) return { ok: false, reason: "not_found" };
    const routes = await this.#routes(state);
    if (!routes) return { ok: false, reason: "unavailable" };
    const plan = planRoutes(routes, state.job.capability, state.job.mode);
    const used = new Set(state.attempts.map((a) => a.route.id));
    if (request.guard) target.guard = request.guard;
    state.retry = { reason: request.reason, feedback: request.feedback ?? null, at: Date.now() };
    state.attempts.push(newAttempt(state, retryRoute(state.job.capability, plan, used), "retry"));
    await this.#tick(state);
    return { ok: true };
  }

  /**
   * The owner deleted their account (spec 5.5): stop every running attempt, give the hold back
   * (the wallet is forfeited right after) and never store another result for this job.
   */
  async cancel(): Promise<void> {
    await this.#stop("account deleted", "FORBIDDEN");
  }

  /** Ops (spec 8.2): a job stuck past its time ends as TIMEOUT and gives its hold back. */
  giveUp(): Promise<"stopped" | "settled" | "missing"> {
    return this.#stop("stuck: given up by ops", "TIMEOUT");
  }

  #stop(message: string, code: ErrorCode): Promise<"stopped" | "settled" | "missing"> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (!state) return "missing";
      if (state.settled) return "settled";
      for (const attempt of state.attempts.filter(isActive)) {
        attempt.state = "abandoned";
        attempt.failMsg = message;
        attempt.finishedAt = Date.now();
        bookEstimate(attempt);
        await this.#dispatcher(state).release(this.#ticket(state, attempt));
      }
      await this.#finish(state, null, code);
      await this.#save(state);
      // Clears the alarm when all is settled; if settling failed, arms its retry (spec 8.2).
      await this.#schedule(state);
      await this.#sync(state);
      return "stopped";
    });
  }

  /** kie called back: check every running attempt now. The callback body is never trusted. */
  poke(): Promise<void> {
    return this.#serial(() => this.#poke());
  }

  async #poke(): Promise<void> {
    const state = await this.#load();
    if (!state) return;
    const now = Date.now();
    for (const attempt of state.attempts) if (attempt.state === "pending") attempt.nextPollAt = now;
    await this.#tick(state);
  }

  alarm(): Promise<void> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (state) await this.#tick(state);
    });
  }

  async #load(): Promise<RunnerState | null> {
    if (this.#state === undefined)
      this.#state = (await this.ctx.storage.get<RunnerState>("state")) ?? null;
    return this.#state;
  }

  async #save(state: RunnerState): Promise<void> {
    await this.ctx.storage.put("state", state);
  }

  #provider(): ProviderKit {
    this.#kit ??= providerKit(this.env);
    return this.#kit;
  }

  #dispatcher(state: RunnerState) {
    const pool = CAPABILITIES[state.job.capability].pool;
    return this.env.DISPATCHER.get(this.env.DISPATCHER.idFromName(pool));
  }

  #ticket(state: RunnerState, attempt: AttemptRecord): string {
    return `${state.job.id}:${attempt.id}`;
  }

  /** Routes with breaker-open models switched off; null when this capability has none left. */
  async #routes(state: RunnerState): Promise<Route[] | null> {
    const capability = state.job.capability;
    const routes = await loadRoutes(this.env.DB);
    const models = [
      ...new Set(
        routes.filter((r) => r.capability === capability && r.enabled).map((r) => r.model),
      ),
    ];
    const allowed = new Set(await this.#dispatcher(state).allowModels(models));
    const usable = routes.map((r) =>
      r.capability === capability && !allowed.has(r.model) ? { ...r, enabled: false } : r,
    );
    return usable.some((r) => r.capability === capability && r.enabled) ? usable : null;
  }

  /**
   * One pass over the job. Whatever throws, the state is saved and the next alarm is armed before
   * the error leaves, so a transient Dispatcher, D1 or provider error never strands a job.
   */
  async #tick(state: RunnerState): Promise<void> {
    try {
      if (state.status === "created") await this.#plan(state);
      for (const attempt of [...state.attempts]) await this.#step(state, attempt);
      await this.#advance(state);
    } finally {
      await this.#save(state);
      await this.#schedule(state);
    }
    await this.#sync(state);
  }

  async #plan(state: RunnerState): Promise<void> {
    const routes = await this.#routes(state);
    if (routes) {
      const plan = planRoutes(routes, state.job.capability, state.job.mode);
      for (const route of plan.primary) state.attempts.push(newAttempt(state, route, "primary"));
      state.fallbacks = plan.fallbacks;
    }
    // With no usable route there are no attempts, and #advance ends the job with PROVIDER_DOWN.
    state.status = "queued";
  }

  async #step(state: RunnerState, attempt: AttemptRecord): Promise<void> {
    if (attempt.state === "queued") await this.#acquire(state, attempt);
    if (attempt.state === "submitting") await this.#submit(state, attempt);
    if (attempt.state === "pending") await this.#poll(state, attempt);
  }

  async #acquire(state: RunnerState, attempt: AttemptRecord): Promise<void> {
    const grant = await this.#dispatcher(state).acquire(
      this.#ticket(state, attempt),
      state.job.priority,
      attempt.route.model,
    );
    if (!grant.granted) {
      attempt.queuePosition = grant.position;
      return;
    }
    attempt.queuePosition = null;
    attempt.state = "submitting";
    // Spec 4.1: record "submitting" before calling kie; after a crash the call is made again.
    await this.#save(state);
  }

  async #submit(state: RunnerState, attempt: AttemptRecord): Promise<void> {
    const now = Date.now();
    try {
      const imageUrl = await presign(this.env, state.job.inputKey, "GET", INPUT_URL_SEC);
      const token = await callbackToken(state.job.id, this.env.HMAC_KEY);
      const callbackUrl = `${this.env.API_ORIGIN}/webhooks/kie/${state.job.id}?t=${token}`;
      const { taskId } = await this.#provider().adapter.submit(
        attempt.route,
        { imageUrl, prompt: state.job.prompt, aspect: state.job.aspect },
        callbackUrl,
      );
      attempt.state = "pending";
      attempt.taskId = taskId;
      attempt.submittedAt = now;
      attempt.deadline = now + attempt.route.timeoutMs;
      attempt.nextPollAt =
        now + Math.min(CAPABILITIES[state.job.capability].p50Ms, attempt.route.timeoutMs);
    } catch (error) {
      const kind: FailKind = error instanceof ProviderError ? error.kind : "provider_error";
      if (kind === "rate_limited") {
        // Spec 4.3: back to the queue; not counted as an attempt.
        await this.#dispatcher(state).release(this.#ticket(state, attempt));
        attempt.state = "queued";
        return;
      }
      await this.#end(state, attempt, kind, message(error));
    }
  }

  async #poll(state: RunnerState, attempt: AttemptRecord): Promise<void> {
    const now = Date.now();
    if (attempt.taskId === null) return;
    const deadline = attempt.deadline ?? now;
    if (now < (attempt.nextPollAt ?? now) && now < deadline) return;
    let status: StatusResult | null;
    try {
      status = await this.#provider().adapter.status(attempt.taskId);
    } catch {
      status = null; // a failed status call is tried again until the deadline
    }
    if (status?.state === "success") return this.#succeed(state, attempt, status);
    if (status?.state === "fail") {
      attempt.costUsd = status.costUsd;
      const kind = this.#provider().adapter.classify({
        code: status.failCode,
        msg: status.failMsg,
      });
      return this.#end(state, attempt, kind, status.failMsg ?? status.failCode ?? "failed");
    }
    if (now >= deadline)
      return this.#end(
        state,
        attempt,
        "timeout",
        "no result before the route timeout",
        "abandoned",
      );
    attempt.nextPollAt = Math.min(now + STATUS_POLL_MS, deadline);
  }

  async #succeed(
    state: RunnerState,
    attempt: AttemptRecord,
    status: Extract<StatusResult, { state: "success" }>,
  ): Promise<void> {
    const prefix = state.job.charge.kind === "credits" ? "keep" : "out";
    const outputKey = `${prefix}/${state.job.id}/${attempt.id}.png`;
    attempt.costUsd = status.costUsd;
    attempt.costTimeMs = status.costTimeMs;
    try {
      const url = status.outputUrls[0];
      if (!url) throw new ProviderError("provider_error", "no output URL");
      await this.#provider().fetchOutput(url, state.job.inputKey, outputKey);
    } catch (error) {
      // Never report success without the file (review focus 4).
      return this.#end(state, attempt, "provider_error", `output: ${message(error)}`);
    }
    attempt.state = "succeeded";
    attempt.outputKey = outputKey;
    attempt.finishedAt = Date.now();
    await this.#dispatcher(state).release(this.#ticket(state, attempt));
    await this.#dispatcher(state).report(attempt.route.model, true);
    this.#record(state, attempt);
  }

  async #end(
    state: RunnerState,
    attempt: AttemptRecord,
    kind: FailKind,
    reason: string,
    as: "failed" | "abandoned" = "failed",
  ): Promise<void> {
    attempt.state = as;
    attempt.failKind = kind;
    attempt.failMsg = reason.slice(0, 500);
    attempt.finishedAt = Date.now();
    if (as === "abandoned") bookEstimate(attempt);
    await this.#dispatcher(state).release(this.#ticket(state, attempt));
    if (BREAKER_KINDS.includes(kind))
      await this.#dispatcher(state).report(attempt.route.model, false);
    this.#record(state, attempt);
    // Cost guardrails spec 6: kie refuses every call until it resets the key, so stop taking jobs.
    if (kind === "key_daily_cap") {
      try {
        await pauseForKieCap(this.env, Date.now());
      } catch (error) {
        // Best effort: the job must still settle and refund.
        console.error(
          JSON.stringify({ level: "error", jobId: state.job.id, pauseForKieCap: message(error) }),
        );
      }
    }
  }

  /** Decides what happens once attempts change: wait, start the fallback, or finish the job. */
  async #advance(state: RunnerState): Promise<void> {
    if (state.attempts.some(isActive)) {
      const running = state.attempts.some((a) => a.state === "submitting" || a.state === "pending");
      state.status = running ? "submitted" : "queued";
      return;
    }
    if (state.settled) {
      // A free retry ended; the job keeps its original outcome and charge.
      state.status = state.chargedTier === null ? "failed" : "succeeded";
      return;
    }
    const paid = state.attempts.filter((a) => !a.freeRetry);
    const delivered = paid.filter((a) => a.state === "succeeded");
    if (delivered.length > 0)
      return this.#finish(state, chargeTier(delivered.map((a) => a.route)), null);
    const last = paid.reduce<AttemptRecord | undefined>(
      (latest, a) =>
        latest === undefined || (a.finishedAt ?? 0) >= (latest.finishedAt ?? 0) ? a : latest,
      undefined,
    );
    const kind: FailKind = last?.failKind ?? "provider_error";
    const next = state.fallbacks[0];
    if (
      next &&
      kind !== "invalid" &&
      kind !== "key_daily_cap" &&
      state.fallbacksUsed < MAX_FALLBACKS
    ) {
      state.fallbacks.shift();
      state.fallbacksUsed += 1;
      const attempt = newAttempt(state, next, "fallback");
      state.attempts.push(attempt);
      await this.#step(state, attempt);
      return this.#advance(state);
    }
    return this.#finish(state, null, FAIL_CODE[kind]);
  }

  async #finish(state: RunnerState, tier: TierId | null, errorCode: ErrorCode | null) {
    state.chargedTier = tier;
    state.errorCode = errorCode;
    state.status = tier === null ? "failed" : "succeeded";
    state.finishedAt ??= Date.now();
    await this.#save(state);
    try {
      await settle(this.env, state.job.id, state.job.charge, tier);
      state.settled = true;
    } catch (error) {
      // Review focus 5: #schedule retries with backoff for as long as it takes; the runtime's own
      // alarm retries give up after a few attempts, so this must not throw.
      state.settleFailures = (state.settleFailures ?? 0) + 1;
      console.error(
        JSON.stringify({ level: "error", jobId: state.job.id, settle: message(error) }),
      );
    }
  }

  /** Mirrors status, attempts and charge into the jobs row when they change (spec 4.6). */
  async #sync(state: RunnerState): Promise<void> {
    const attempts = state.attempts.map((a) => ({
      id: a.id,
      routeId: a.route.id,
      model: a.route.model,
      role: a.role,
      freeRetry: a.freeRetry,
      state: a.state,
      taskId: a.taskId,
      submittedAt: a.submittedAt,
      finishedAt: a.finishedAt,
      costUsd: a.costUsd,
      costEstimated: a.costEstimated,
      costTimeMs: a.costTimeMs,
      failKind: a.failKind,
      failMsg: a.failMsg,
      guard: a.guard,
    }));
    const charge = {
      kind: state.job.charge.kind,
      tier: state.chargedTier,
      credits:
        state.chargedTier !== null && state.job.charge.kind === "credits"
          ? TIERS[state.chargedTier].credits
          : 0,
    };
    const signature = JSON.stringify([state.status, attempts, charge, state.errorCode]);
    if (signature === state.syncedSig) return;
    await this.env.DB.prepare(
      "UPDATE jobs SET status=?, attempts=?, charge=?, error_code=?, finished_at=? WHERE id=?",
    )
      .bind(
        state.status,
        JSON.stringify(attempts),
        JSON.stringify(charge),
        state.errorCode,
        state.finishedAt,
        state.job.id,
      )
      .run();
    state.syncedSig = signature;
    await this.#save(state);
  }

  async #schedule(state: RunnerState): Promise<void> {
    const now = Date.now();
    const times = state.attempts.flatMap((a) => {
      if (a.state === "queued" || a.state === "submitting") return [now + QUEUE_POLL_MS];
      if (a.state === "pending") return [Math.min(a.nextPollAt ?? now, a.deadline ?? now)];
      return [];
    });
    if (state.status === "created") times.push(now + QUEUE_POLL_MS);
    const ended = state.status === "succeeded" || state.status === "failed";
    if (ended && !state.settled && !state.attempts.some(isActive)) {
      const failures = Math.max(1, state.settleFailures ?? 0);
      times.push(now + Math.min(SETTLE_RETRY_MAX_MS, SETTLE_RETRY_MS * 2 ** (failures - 1)));
    }
    if (times.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(now, Math.min(...times)));
  }

  #record(state: RunnerState, attempt: AttemptRecord): void {
    recordAttempt(this.env, {
      capability: state.job.capability,
      model: attempt.route.model,
      outcome:
        attempt.state === "succeeded" || attempt.state === "abandoned" ? attempt.state : "failed",
      failKind: attempt.failKind,
      freeRetry: attempt.freeRetry,
      costUsd: attempt.costUsd,
      durationMs:
        attempt.submittedAt === null
          ? null
          : (attempt.finishedAt ?? Date.now()) - attempt.submittedAt,
    });
  }

  #view(state: RunnerState): RunnerView {
    const now = Date.now();
    const positions = state.attempts.flatMap((a) =>
      a.state === "queued" && a.queuePosition !== null ? [a.queuePosition] : [],
    );
    const submitted = state.attempts.flatMap((a) =>
      a.state === "pending" && a.submittedAt !== null ? [a.submittedAt] : [],
    );
    const p50 = CAPABILITIES[state.job.capability].p50Ms;
    return {
      job: state.job,
      status: state.status,
      queuePosition: positions.length > 0 ? Math.min(...positions) : null,
      etaMs: submitted.length > 0 ? Math.max(0, p50 - (now - Math.min(...submitted))) : null,
      attempts: state.attempts.map((a) => ({
        id: a.id,
        label: a.route.label,
        model: a.route.model,
        role: a.role,
        freeRetry: a.freeRetry,
        state: a.state,
        outputKey: a.outputKey,
        failKind: a.failKind,
      })),
      chargedTier: state.chargedTier,
      errorCode: state.errorCode,
      finishedAt: state.finishedAt,
    };
  }
}

/** A submitted call that never reported back may still have cost money: book the estimate. */
function bookEstimate(attempt: AttemptRecord): void {
  if (attempt.costUsd === null && attempt.taskId !== null) {
    attempt.costUsd = attempt.route.costUsd;
    attempt.costEstimated = true;
  }
}
