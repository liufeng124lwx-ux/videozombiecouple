import { DurableObject } from "cloudflare:workers";
import {
  CAPABILITIES,
  CAPTION_SEC,
  type CapabilityId,
  REQUIRED_FACES,
  RETENTION,
  SCENES,
  STORYBOARD,
  TIERS,
} from "@vzc/catalog";
import type { ErrorCode, StoryView } from "@vzc/contracts";
import {
  type FailKind,
  ProviderError,
  pickSeconds,
  planRoutes,
  type Route,
  type StatusResult,
} from "@vzc/providers";
import { pauseForKieCap } from "../ops/kie-cap.ts";
import { recordAttempt } from "../services/analytics.ts";
import { type ComposerApi, composerFor } from "../services/composer.ts";
import { callbackToken } from "../services/crypto.ts";
import { sendMail } from "../services/mail.ts";
import { type ProviderKit, providerKit } from "../services/provider-kit.ts";
import { presign } from "../services/r2-presign.ts";
import { loadRoutes } from "../services/routes-store.ts";
import { type ChargeHold, settle } from "../services/settle.ts";
import {
  activePhase,
  kieInputFor,
  outputKeyFor,
  phaseOutcome,
  previewSteps,
  readySteps,
  videoSteps,
} from "../stories/graph.ts";
import type { AttemptRecord, Phase, StepRecord, StorySpec, StoryState } from "../stories/types.ts";
import type { Bindings } from "../types.ts";

const QUEUE_POLL_MS = 2_000;
const STATUS_POLL_MS = 5_000;
/** kie reads inputs through links this long-lived. */
const INPUT_URL_SEC = 3_600;
/** Each kie step may switch routes this many times (spec §4.2: switch model, redo only that step). */
const MAX_FALLBACKS = 2;
/** Composer calls back off from 30 s to 15 min; the step fails after this many errors. */
const COMPOSER_RETRY_MS = 30_000;
const COMPOSER_RETRY_MAX_MS = 15 * 60_000;
export const COMPOSER_MAX_FAILURES = 5;
const SETTLE_RETRY_MS = 30_000;
const SETTLE_RETRY_MAX_MS = 15 * 60_000;
/** Only these say something about a model's health; a rejected photo does not. */
const BREAKER_KINDS: readonly FailKind[] = ["provider_error", "timeout"];
/** Composer step p50s for the progress estimate. */
const COMPOSE_P50_MS = 40_000;
const CAPTION_LINE1 = "Even at the end of the world.";

const FAIL_CODE: Record<FailKind, ErrorCode> = {
  content_rejected: "CONTENT_REJECTED",
  timeout: "TIMEOUT",
  provider_error: "PROVIDER_DOWN",
  invalid: "FILE_UNSUPPORTED",
  rate_limited: "PROVIDER_DOWN",
  key_daily_cap: "PAUSED",
};

const isActive = (a: AttemptRecord) =>
  a.state === "queued" || a.state === "submitting" || a.state === "pending";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type RenderOutcome = { ok: true } | { ok: false; reason: "not_ready" | "already" };
export type RecomposeOutcome = { ok: true } | { ok: false; reason: "used" | "not_done" };

function newAttempt(step: StepRecord, route: Route): AttemptRecord {
  return {
    id: `a${step.attempts.length + 1}`,
    route,
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
  };
}

/** A submitted call that never reported back may still have cost money: book the estimate. */
function bookEstimate(attempt: AttemptRecord): void {
  if (attempt.costUsd === null && attempt.taskId !== null) {
    attempt.costUsd = attempt.route.costUsd;
    attempt.costEstimated = true;
  }
}

/**
 * One object per story (spec §4.2). It walks the step graph: kie steps get a Dispatcher slot,
 * submit, poll (or are poked by kie's callback), store their output in R2 and switch routes on
 * failure; scoring and composing call the composer container with backoff. The free preview and
 * the paid video settle their holds once their phase ends. All waiting is done with the DO alarm.
 */
export class StoryRunner extends DurableObject<Bindings> {
  #state: StoryState | null | undefined;
  #kit: ProviderKit | undefined;
  #queue: Promise<unknown> = Promise.resolve();

  /** Entry points run one at a time (input gates only cover storage). */
  #serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(run, run);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  start(spec: StorySpec, previewCharge: ChargeHold): Promise<StoryView> {
    return this.#serial(async () => {
      const existing = await this.#load();
      if (existing) return this.#view(existing);
      const state: StoryState = {
        spec,
        status: "previewing",
        steps: Object.fromEntries([...previewSteps(), ...videoSteps()].map((s) => [s.id, s])),
        picks: {},
        previewCharge,
        videoCharge: null,
        previewSettled: false,
        videoSettled: false,
        recomposeLeft: 1,
        output: null,
        errorCode: null,
        finishedAt: null,
        syncedSig: "",
      };
      this.#state = state;
      // Persist before any I/O: if the first slot request fails, the alarm resumes it.
      await this.#save(state);
      await this.#tick(state);
      return this.#view(state);
    });
  }

  /** Spec §4.1 step 3: the paid video starts only from a ready preview, once. */
  render(videoCharge: ChargeHold): Promise<RenderOutcome> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (!state || (state.status !== "preview_ready" && state.videoCharge === null))
        return { ok: false, reason: "not_ready" };
      if (state.videoCharge !== null) return { ok: false, reason: "already" };
      state.videoCharge = videoCharge;
      state.status = "rendering";
      state.errorCode = null;
      await this.#save(state);
      await this.#tick(state);
      return { ok: true };
    });
  }

  /** Spec §7: one free change of the end title; only the compose step runs again. */
  recompose(names: string, date: string): Promise<RecomposeOutcome> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (!state || state.status !== "done") return { ok: false, reason: "not_done" };
      if (state.recomposeLeft <= 0) return { ok: false, reason: "used" };
      state.recomposeLeft -= 1;
      state.spec.names = names || null;
      state.spec.date = date || null;
      const compose = state.steps.compose as StepRecord;
      Object.assign(compose, {
        state: "waiting",
        failures: 0,
        nextRunAt: null,
        error: null,
        failKind: null,
      });
      state.status = "rendering";
      await this.#save(state);
      await this.#tick(state);
      return { ok: true };
    });
  }

  async view(): Promise<StoryView | null> {
    const state = await this.#load();
    return state ? this.#view(state) : null;
  }

  /** kie called back: poll every pending attempt now. The callback body is never trusted. */
  poke(): Promise<void> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (!state) return;
      const now = Date.now();
      for (const step of Object.values(state.steps))
        for (const a of step.attempts) if (a.state === "pending") a.nextPollAt = now;
      await this.#tick(state);
    });
  }

  /** The owner deleted their account: stop everything and give every hold back. */
  cancel(): Promise<void> {
    return this.#stop("account deleted", "FORBIDDEN").then(() => undefined);
  }

  /** Ops: a story stuck past its time ends as TIMEOUT and gives its holds back. */
  giveUp(): Promise<"stopped" | "settled" | "missing"> {
    return this.#stop("stuck: given up by ops", "TIMEOUT");
  }

  alarm(): Promise<void> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (state) await this.#tick(state);
    });
  }

  #stop(reason: string, code: ErrorCode): Promise<"stopped" | "settled" | "missing"> {
    return this.#serial(async () => {
      const state = await this.#load();
      if (!state) return "missing";
      const open =
        (state.previewCharge && !state.previewSettled) ||
        (state.videoCharge && !state.videoSettled);
      const running = state.status === "previewing" || state.status === "rendering";
      if (!open && !running) return "settled";
      await this.#abandonAll(state, reason);
      if (state.status === "previewing") state.status = "preview_failed";
      else if (state.status === "rendering" && !state.videoSettled) state.status = "failed";
      else if (state.status === "rendering") state.status = "done";
      state.errorCode = code;
      state.finishedAt ??= Date.now();
      await this.#settleOpen(state, false);
      await this.#save(state);
      await this.#schedule(state);
      await this.#sync(state);
      return "stopped";
    });
  }

  async #load(): Promise<StoryState | null> {
    if (this.#state === undefined)
      this.#state = (await this.ctx.storage.get<StoryState>("state")) ?? null;
    return this.#state;
  }

  async #save(state: StoryState): Promise<void> {
    await this.ctx.storage.put("state", state);
  }

  #provider(): ProviderKit {
    this.#kit ??= providerKit(this.env);
    return this.#kit;
  }

  #composer(): ComposerApi {
    return composerFor(this.env);
  }

  #dispatcher(capability: CapabilityId) {
    const pool = CAPABILITIES[capability].pool;
    return this.env.DISPATCHER.get(this.env.DISPATCHER.idFromName(pool));
  }

  #ticket(state: StoryState, step: StepRecord, attempt: AttemptRecord): string {
    return `${state.spec.id}:${step.id}:${attempt.id}`;
  }

  #url(key: string): Promise<string> {
    return presign(this.env, key, "GET", INPUT_URL_SEC);
  }

  /** Routes with breaker-open models switched off; empty when the capability has none left. */
  async #routes(capability: CapabilityId): Promise<Route[]> {
    const routes = await loadRoutes(this.env.DB);
    const models = [
      ...new Set(
        routes.filter((r) => r.capability === capability && r.enabled).map((r) => r.model),
      ),
    ];
    const allowed = new Set(await this.#dispatcher(capability).allowModels(models));
    return routes.map((r) =>
      r.capability === capability && !allowed.has(r.model) ? { ...r, enabled: false } : r,
    );
  }

  /** One pass. Whatever throws, the state is saved and the next alarm armed before it leaves. */
  async #tick(state: StoryState): Promise<void> {
    try {
      for (const step of readySteps(state)) await this.#begin(state, step);
      const phase = activePhase(state);
      if (phase)
        for (const step of Object.values(state.steps)) {
          if (step.phase !== phase) continue;
          if (step.kind === "kie") await this.#stepKie(state, step);
          else if (step.state === "running") await this.#stepComposer(state, step);
        }
      await this.#advance(state);
    } finally {
      await this.#save(state);
      await this.#schedule(state);
    }
    await this.#sync(state);
  }

  async #begin(state: StoryState, step: StepRecord): Promise<void> {
    if (step.kind !== "kie") {
      step.state = "running";
      step.nextRunAt = Date.now();
      return;
    }
    const capability = step.capability as CapabilityId;
    const usable = await this.#routes(capability);
    if (!usable.some((r) => r.capability === capability && r.enabled)) {
      step.state = "failed";
      step.failKind = "provider_error";
      step.error = "no usable route";
      return;
    }
    const plan = planRoutes(usable, capability, state.spec.kind);
    const [first, ...rest] = plan.primary;
    step.fallbacks = [...rest, ...plan.fallbacks];
    step.attempts.push(newAttempt(step, first as Route));
    step.state = "queued";
  }

  async #stepKie(state: StoryState, step: StepRecord): Promise<void> {
    const attempt = step.attempts.at(-1);
    if (!attempt || !isActive(attempt)) return;
    if (attempt.state === "queued") await this.#acquire(state, step, attempt);
    if (attempt.state === "submitting") await this.#submit(state, step, attempt);
    if (attempt.state === "pending") await this.#poll(state, step, attempt);
  }

  async #acquire(state: StoryState, step: StepRecord, attempt: AttemptRecord): Promise<void> {
    const grant = await this.#dispatcher(step.capability as CapabilityId).acquire(
      this.#ticket(state, step, attempt),
      step.phase === "video" ? "paid" : "free",
      attempt.route.model,
    );
    if (!grant.granted) {
      attempt.queuePosition = grant.position;
      return;
    }
    attempt.queuePosition = null;
    attempt.state = "submitting";
    step.state = "submitting";
    // Record "submitting" before calling kie; after a crash the call is made again.
    await this.#save(state);
  }

  async #submit(state: StoryState, step: StepRecord, attempt: AttemptRecord): Promise<void> {
    const now = Date.now();
    try {
      const input = await kieInputFor(step, state, (key) => this.#url(key));
      const token = await callbackToken(state.spec.id, this.env.HMAC_KEY);
      const callbackUrl = `${this.env.API_ORIGIN}/webhooks/kie/${state.spec.id}?t=${token}`;
      const { taskId } = await this.#provider().adapter.submit(
        attempt.route,
        {
          prompt: input.prompt,
          images: input.images,
          ...(input.first ? { first: input.first } : {}),
          ...(input.last ? { last: input.last } : {}),
          ...(input.targetSec !== undefined
            ? { seconds: pickSeconds(attempt.route, input.targetSec) }
            : {}),
          aspect: "9:16",
        },
        callbackUrl,
      );
      attempt.state = "pending";
      attempt.taskId = taskId;
      attempt.submittedAt = now;
      attempt.deadline = now + attempt.route.timeoutMs;
      const p50 = CAPABILITIES[step.capability as CapabilityId].p50Ms;
      attempt.nextPollAt = now + Math.min(p50, attempt.route.timeoutMs);
      step.state = "pending";
    } catch (error) {
      const kind: FailKind = error instanceof ProviderError ? error.kind : "provider_error";
      if (kind === "rate_limited") {
        // Back to the queue; not counted as an attempt.
        await this.#dispatcher(step.capability as CapabilityId).release(
          this.#ticket(state, step, attempt),
        );
        attempt.state = "queued";
        step.state = "queued";
        return;
      }
      await this.#endAttempt(state, step, attempt, kind, message(error));
    }
  }

  async #poll(state: StoryState, step: StepRecord, attempt: AttemptRecord): Promise<void> {
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
    if (status?.state === "success") return this.#succeed(state, step, attempt, status);
    if (status?.state === "fail") {
      attempt.costUsd = status.costUsd;
      const kind = this.#provider().adapter.classify({
        code: status.failCode,
        msg: status.failMsg,
      });
      return this.#endAttempt(
        state,
        step,
        attempt,
        kind,
        status.failMsg ?? status.failCode ?? "failed",
      );
    }
    if (now >= deadline)
      return this.#endAttempt(
        state,
        step,
        attempt,
        "timeout",
        "no result before the route timeout",
        "abandoned",
      );
    attempt.nextPollAt = Math.min(now + STATUS_POLL_MS, deadline);
  }

  async #succeed(
    state: StoryState,
    step: StepRecord,
    attempt: AttemptRecord,
    status: Extract<StatusResult, { state: "success" }>,
  ): Promise<void> {
    const ext = step.capability === "shot" ? "mp4" : "jpg";
    const outputKey = outputKeyFor(state.spec.id, step.id, ext);
    attempt.costUsd = status.costUsd;
    attempt.costTimeMs = status.costTimeMs;
    try {
      const url = status.outputUrls[0];
      if (!url) throw new ProviderError("provider_error", "no output URL");
      // The fake provider copies this input as its "output".
      const source = this.#fakeSource(state, step);
      await this.#provider().fetchOutput(url, source, outputKey);
    } catch (error) {
      // Never report success without the file.
      return this.#endAttempt(state, step, attempt, "provider_error", `output: ${message(error)}`);
    }
    attempt.state = "succeeded";
    attempt.finishedAt = Date.now();
    step.state = "succeeded";
    step.outputKey = outputKey;
    const dispatcher = this.#dispatcher(step.capability as CapabilityId);
    await dispatcher.release(this.#ticket(state, step, attempt));
    await dispatcher.report(attempt.route.model, true);
    this.#record(state, step, attempt);
  }

  #fakeSource(state: StoryState, step: StepRecord): string {
    if (step.capability !== "shot") return state.spec.survivorKey;
    const shot = STORYBOARD.find((s) => `shot:${s.id}` === step.id);
    return (shot && state.picks[shot.first === "B" ? "A" : shot.first]) ?? state.spec.survivorKey;
  }

  async #endAttempt(
    state: StoryState,
    step: StepRecord,
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
    const dispatcher = this.#dispatcher(step.capability as CapabilityId);
    await dispatcher.release(this.#ticket(state, step, attempt));
    if (BREAKER_KINDS.includes(kind)) await dispatcher.report(attempt.route.model, false);
    this.#record(state, step, attempt);
    if (kind === "key_daily_cap") {
      try {
        await pauseForKieCap(this.env, Date.now());
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            storyId: state.spec.id,
            pauseForKieCap: message(error),
          }),
        );
      }
    }
    const switches = step.attempts.length - 1;
    const next = step.fallbacks[0];
    if (next && kind !== "invalid" && kind !== "key_daily_cap" && switches < MAX_FALLBACKS) {
      step.fallbacks.shift();
      const retry = newAttempt(step, next);
      step.attempts.push(retry);
      step.state = "queued";
      await this.#acquire(state, step, retry);
      if (retry.state === "submitting") await this.#submit(state, step, retry);
      return;
    }
    step.state = "failed";
    step.failKind = kind;
    step.error = reason.slice(0, 200);
  }

  async #stepComposer(state: StoryState, step: StepRecord): Promise<void> {
    const now = Date.now();
    if (step.nextRunAt !== null && now < step.nextRunAt) return;
    try {
      if (step.id === "score:sources") await this.#checkSources(state, step);
      else if (step.kind === "score") await this.#score(state, step);
      else await this.#compose(state, step);
    } catch (error) {
      step.failures += 1;
      step.error = message(error).slice(0, 200);
      if (step.failures >= COMPOSER_MAX_FAILURES) {
        step.state = "failed";
        step.failKind = "provider_error";
        step.nextRunAt = null;
        return;
      }
      step.nextRunAt =
        now + Math.min(COMPOSER_RETRY_MAX_MS, COMPOSER_RETRY_MS * 2 ** (step.failures - 1));
    }
  }

  /** Spec §4.2 S0b: one face in each photo (the pet photo is not checked) and no one under 18. */
  async #checkSources(state: StoryState, step: StepRecord): Promise<void> {
    const { spec } = state;
    const pet = spec.kind === "pet";
    const result = await this.#composer().score({
      sources: {
        survivor: await this.#url(spec.survivorKey),
        infected: pet ? null : await this.#url(spec.infectedKey),
      },
      candidates: [],
      requiredFaces: { A: [], B: [], C: [] },
      checkAge: true,
    });
    step.nextRunAt = null;
    if (!result.sourceFaces.survivor || (!pet && result.sourceFaces.infected === false)) {
      step.state = "failed";
      step.error = "FACE_NOT_FOUND";
      return;
    }
    if (result.minAge !== null && result.minAge < 18) {
      step.state = "failed";
      step.error = "UNDERAGE";
      return;
    }
    step.state = "succeeded";
  }

  async #score(state: StoryState, step: StepRecord): Promise<void> {
    const { spec } = state;
    const succeeded = step.deps
      .map((id) => state.steps[id])
      .filter((s): s is StepRecord => !!s && s.state === "succeeded" && !!s.outputKey);
    const candidates = await Promise.all(
      succeeded.map(async (s) => ({
        id: s.id,
        url: await this.#url(s.outputKey as string),
        frame: s.id.split(":")[1] as "A" | "C",
      })),
    );
    const pet = spec.kind === "pet";
    const result = await this.#composer().score({
      sources: {
        survivor: await this.#url(spec.survivorKey),
        infected: pet ? null : await this.#url(spec.infectedKey),
      },
      candidates,
      requiredFaces: pet ? { A: [], B: ["survivor"], C: ["survivor"] } : REQUIRED_FACES,
      checkAge: true,
    });
    step.nextRunAt = null;
    if (!result.sourceFaces.survivor || (!pet && result.sourceFaces.infected === false)) {
      step.state = "failed";
      step.error = "FACE_NOT_FOUND";
      return;
    }
    if (result.minAge !== null && result.minAge < 18) {
      step.state = "failed";
      step.error = "UNDERAGE";
      return;
    }
    for (const frame of ["A", "C"] as const) {
      const options = candidates.filter((c) => c.frame === frame);
      const best = options.reduce<{ id: string; score: number } | null>((top, c) => {
        const score = result.scores[c.id] ?? null;
        if (score === null) return top ?? { id: c.id, score: -1 };
        return top === null || score > top.score ? { id: c.id, score } : top;
      }, null);
      const chosen = state.steps[best?.id ?? ""]?.outputKey;
      if (chosen) state.picks[frame] = chosen;
    }
    step.state = "succeeded";
  }

  async #compose(state: StoryState, step: StepRecord): Promise<void> {
    const { spec } = state;
    const shots = STORYBOARD.map((shot) => {
      const key = state.steps[`shot:${shot.id}`]?.outputKey;
      if (!key) throw new Error(`shot ${shot.id} has no output`);
      return {
        key,
        seconds: shot.targetSec,
        grade: shot.first === "C" ? "warm" : "cold",
        anchor: shot.last ? "end" : "start",
      } as const;
    });
    const outKey = `out/${spec.id}/video.mp4`;
    const posterKey = `out/${spec.id}/poster.jpg`;
    const line2 =
      spec.names && spec.date ? `${spec.names} · ${spec.date}` : (spec.names ?? spec.date);
    await this.#composer().compose({
      shots: await Promise.all(
        shots.map(async (s) => ({
          url: await this.#url(s.key),
          seconds: s.seconds,
          grade: s.grade,
          anchor: s.anchor,
        })),
      ),
      musicUrl: await this.#url(`assets/${SCENES[spec.scene].musicKey}`),
      caption: { line1: CAPTION_LINE1, line2: line2 ?? null },
      outUrl: await presign(this.env, outKey, "PUT", INPUT_URL_SEC),
      posterUrl: await presign(this.env, posterKey, "PUT", INPUT_URL_SEC),
      keys: { shots: shots.map((s) => s.key), out: outKey, poster: posterKey },
    });
    step.state = "succeeded";
    step.outputKey = outKey;
    step.nextRunAt = null;
    state.output = { videoKey: outKey, posterKey };
  }

  /** Decides what a phase's end means: settle the hold and set the story status. */
  async #advance(state: StoryState): Promise<void> {
    const phase = activePhase(state);
    if (phase) {
      const outcome = phaseOutcome(state, phase);
      if (outcome === "running") return;
      await this.#abandonPhase(state, phase, "phase ended");
      const ok = outcome === "succeeded";
      if (phase === "preview") {
        state.status = ok ? "preview_ready" : "preview_failed";
        if (!ok) state.errorCode = this.#errorCode(state, phase);
      } else if (state.videoSettled) {
        // A recompose ended: the video stays delivered either way.
        state.status = "done";
        if (!ok) state.errorCode = "COMPOSE_FAILED";
      } else {
        state.status = ok ? "done" : "failed";
        if (!ok) state.errorCode = this.#errorCode(state, phase);
      }
      state.finishedAt = Date.now();
    }
    await this.#settleOpen(state, true);
    if (state.status === "done" && !state.notified) await this.#notify(state);
  }

  /** Spec §4.1 step 4: tell the owner the film is ready (best effort, once). */
  async #notify(state: StoryState): Promise<void> {
    state.notified = true;
    try {
      const user = await this.env.DB.prepare(
        "SELECT email FROM users WHERE id=? AND deleted_at IS NULL",
      )
        .bind(state.spec.userId)
        .first<{ email: string }>();
      if (!user) return;
      await sendMail(this.env, {
        to: user.email,
        subject: "Your zombie love story is ready",
        intro: `Your ${STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC}-second film is ready to watch and download. The file is kept for ${RETENTION.outputDays} days.`,
        link: {
          href: `${this.env.ALLOWED_ORIGIN}/story?id=${state.spec.id}`,
          label: "Watch your film",
        },
      });
    } catch (error) {
      console.error(
        JSON.stringify({ level: "error", storyId: state.spec.id, notify: message(error) }),
      );
    }
  }

  #errorCode(state: StoryState, phase: Phase): ErrorCode {
    const failed = Object.values(state.steps).filter(
      (s) => s.phase === phase && s.state === "failed",
    );
    for (const s of failed) {
      if (s.error === "FACE_NOT_FOUND" || s.error === "UNDERAGE") return s.error;
      if (s.kind === "compose") return "COMPOSE_FAILED";
    }
    const last = failed.find((s) => s.failKind !== null);
    return FAIL_CODE[last?.failKind ?? "provider_error"];
  }

  /** Settles every hold whose phase has ended; retried by the alarm when it throws. */
  async #settleOpen(state: StoryState, deliver: boolean): Promise<void> {
    try {
      if (state.previewCharge && !state.previewSettled && state.status !== "previewing") {
        const ok = deliver && state.status !== "preview_failed";
        await settle(this.env, `${state.spec.id}:preview`, state.previewCharge, ok ? 0 : null);
        state.previewSettled = true;
      }
      if (
        state.videoCharge &&
        !state.videoSettled &&
        (state.status === "done" || state.status === "failed")
      ) {
        const ok = deliver && state.status === "done";
        await settle(this.env, state.spec.id, state.videoCharge, ok ? TIERS.video.credits : null);
        state.videoSettled = true;
      }
      state.settleFailures = 0;
    } catch (error) {
      state.settleFailures = (state.settleFailures ?? 0) + 1;
      console.error(
        JSON.stringify({ level: "error", storyId: state.spec.id, settle: message(error) }),
      );
    }
  }

  async #abandonPhase(state: StoryState, phase: Phase, reason: string): Promise<void> {
    for (const step of Object.values(state.steps)) {
      if (step.phase !== phase) continue;
      for (const attempt of step.attempts.filter(isActive)) {
        attempt.state = "abandoned";
        attempt.failMsg = reason;
        attempt.finishedAt = Date.now();
        bookEstimate(attempt);
        await this.#dispatcher(step.capability as CapabilityId).release(
          this.#ticket(state, step, attempt),
        );
        this.#record(state, step, attempt);
      }
      if (step.state !== "succeeded" && step.state !== "failed" && step.state !== "waiting")
        step.state = "failed";
    }
  }

  async #abandonAll(state: StoryState, reason: string): Promise<void> {
    await this.#abandonPhase(state, "preview", reason);
    await this.#abandonPhase(state, "video", reason);
  }

  async #schedule(state: StoryState): Promise<void> {
    const now = Date.now();
    const times: number[] = [];
    const phase = activePhase(state);
    for (const step of Object.values(state.steps)) {
      if (step.phase !== phase) continue;
      if (step.kind !== "kie" && step.state === "running") times.push(step.nextRunAt ?? now);
      for (const a of step.attempts) {
        if (a.state === "queued" || a.state === "submitting") times.push(now + QUEUE_POLL_MS);
        if (a.state === "pending") times.push(Math.min(a.nextPollAt ?? now, a.deadline ?? now));
      }
    }
    // Ready steps waiting to begin (e.g. right after a phase starts).
    if (phase && readySteps(state).length > 0) times.push(now);
    const unsettled =
      (state.previewCharge && !state.previewSettled && state.status !== "previewing") ||
      (state.videoCharge &&
        !state.videoSettled &&
        (state.status === "done" || state.status === "failed"));
    if (unsettled) {
      const failures = Math.max(1, state.settleFailures ?? 0);
      times.push(now + Math.min(SETTLE_RETRY_MAX_MS, SETTLE_RETRY_MS * 2 ** (failures - 1)));
    }
    if (times.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(now, Math.min(...times)));
  }

  /** Mirrors status, picks, output and cost into the stories row when they change. */
  async #sync(state: StoryState): Promise<void> {
    const steps = Object.values(state.steps).map((s) => ({
      id: s.id,
      phase: s.phase,
      capability: s.capability ?? s.kind,
      state: s.state,
      error: s.error,
      attempts: s.attempts.map((a) => ({
        model: a.route.model,
        state: a.state,
        taskId: a.taskId,
        costUsd: a.costUsd,
        costEstimated: a.costEstimated ?? false,
        costTimeMs: a.costTimeMs,
        finishedAt: a.finishedAt,
        failKind: a.failKind,
      })),
    }));
    const costUsd = Object.values(state.steps)
      .flatMap((s) => s.attempts)
      .reduce((sum, a) => sum + (a.costUsd ?? 0), 0);
    const signature = JSON.stringify([
      state.status,
      state.picks,
      state.output,
      state.errorCode,
      steps,
    ]);
    if (signature === state.syncedSig) return;
    await this.env.DB.prepare(
      "UPDATE stories SET status=?, picks=?, steps=?, output_key=?, poster_key=?, error_code=?, cost_usd=?, names=?, date=?, finished_at=?, expires_at=CASE WHEN ?='done' THEN ? ELSE expires_at END WHERE id=?",
    )
      .bind(
        state.status,
        JSON.stringify(state.picks),
        JSON.stringify(steps),
        state.output?.videoKey ?? null,
        state.output?.posterKey ?? null,
        state.errorCode,
        Math.round(costUsd * 1e6) / 1e6,
        state.spec.names,
        state.spec.date,
        state.finishedAt,
        state.status,
        (state.finishedAt ?? Date.now()) + RETENTION.outputDays * 86_400_000,
        state.spec.id,
      )
      .run();
    state.syncedSig = signature;
    await this.#save(state);
  }

  #record(state: StoryState, step: StepRecord, attempt: AttemptRecord): void {
    recordAttempt(this.env, {
      capability: step.capability ?? step.kind,
      model: attempt.route.model,
      outcome:
        attempt.state === "succeeded" || attempt.state === "abandoned" ? attempt.state : "failed",
      failKind: attempt.failKind,
      free: step.phase === "preview",
      costUsd: attempt.costUsd,
      durationMs:
        attempt.submittedAt === null
          ? null
          : (attempt.finishedAt ?? Date.now()) - attempt.submittedAt,
    });
    void state;
  }

  async #view(state: StoryState): Promise<StoryView> {
    const phase =
      state.status === "previewing" || state.status === "preview_failed" ? "preview" : "video";
    const steps = Object.values(state.steps).filter((s) => s.phase === phase);
    const done = steps.filter((s) => s.state === "succeeded").length;
    const sign = (key: string) => presign(this.env, key, "GET", RETENTION.signedUrlSeconds);
    const showPreview = state.picks.A && state.picks.C && state.status !== "preview_failed";
    return {
      id: state.spec.id,
      status: state.status,
      kind: state.spec.kind,
      scene: state.spec.scene,
      names: state.spec.names,
      date: state.spec.date,
      preview: showPreview
        ? { A: await sign(state.picks.A as string), C: await sign(state.picks.C as string) }
        : null,
      video:
        state.output && state.status === "done"
          ? {
              url: await sign(state.output.videoKey),
              poster: await sign(state.output.posterKey),
              expiresAt: (state.finishedAt ?? Date.now()) + RETENTION.outputDays * 86_400_000,
            }
          : null,
      progress: { done, total: steps.length, etaMs: this.#eta(state, phase, steps) },
      errorCode: state.errorCode,
      recomposeLeft: state.recomposeLeft,
      createdAt: state.spec.createdAt,
    };
  }

  /** A rough "about N seconds left" from the p50s of the steps still to run. */
  #eta(state: StoryState, phase: Phase, steps: StepRecord[]): number | null {
    if (activePhase(state) !== phase) return null;
    const left = steps.filter((s) => s.state !== "succeeded" && s.state !== "failed");
    if (left.length === 0) return null;
    const p50 = (s: StepRecord) =>
      s.kind === "kie" ? CAPABILITIES[s.capability as CapabilityId].p50Ms : COMPOSE_P50_MS;
    // Keyframes and shots run in parallel: the slowest open kie step plus the composer steps.
    const kie = Math.max(0, ...left.filter((s) => s.kind === "kie").map(p50));
    const composer = left.filter((s) => s.kind !== "kie").reduce((t, s) => t + p50(s), 0);
    return kie + composer;
  }
}
