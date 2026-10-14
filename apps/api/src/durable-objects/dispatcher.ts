import { DurableObject } from "cloudflare:workers";
import { DISPATCH } from "@vzc/catalog";
import { breakerChanged } from "../ops/breaker-alerts.ts";
import type { Bindings } from "../types.ts";

export type Priority = "paid" | "free";
export type Grant = { granted: true } | { granted: false; position: number };

type Waiting = { ticketId: string; priority: Priority; enqueuedAt: number; seenAt: number };
type Breaker = { outcomes: boolean[]; openedAt: number | null; probeAt: number | null };
type State = {
  tokens: number;
  refilledAt: number;
  queue: Waiting[];
  /** ticketId → granted at. */
  inflight: Record<string, number>;
  /** Paid grants since the last free grant. */
  paidStreak: number;
  breakers: Record<string, Breaker>;
};

const REFILL_PER_MS = DISPATCH.tokensPer10s / 10_000;
/** Runners ask every 2 seconds; 30 seconds of silence means the runner is gone. */
export const STALE_WAITING_MS = 30_000;
/** Longer than any route timeout (180s) plus polling slack; frees slots leaked by a lost runner. */
export const STALE_INFLIGHT_MS = 10 * 60_000;
/** Fewer outcomes than this say nothing about a model (deviation from spec 4.2, see plan). */
export const MIN_BREAKER_SAMPLES = 10;

/** Spec 4.2: paid first, but at least one free job after every `paidPerFree` paid ones. */
function grantOrder(queue: readonly Waiting[], paidStreak: number): Waiting[] {
  const byTime = (a: Waiting, b: Waiting) => a.enqueuedAt - b.enqueuedAt;
  const paid = queue.filter((w) => w.priority === "paid").sort(byTime);
  const free = queue.filter((w) => w.priority === "free").sort(byTime);
  const order: Waiting[] = [];
  let streak = paidStreak;
  while (paid.length > 0 || free.length > 0) {
    const takeFree = free.length > 0 && (streak >= DISPATCH.paidPerFree || paid.length === 0);
    const next = (takeFree ? free.shift() : paid.shift()) as Waiting;
    order.push(next);
    streak = takeFree ? 0 : streak + 1;
  }
  return order;
}

/**
 * One object per resource pool (`kie-image`). JobRunners ask for a slot before each provider call
 * and give it back when the call ends; the pool also keeps a breaker per model.
 */
export class Dispatcher extends DurableObject<Bindings> {
  #state: State | undefined;

  async #load(): Promise<State> {
    this.#state ??= (await this.ctx.storage.get<State>("state")) ?? {
      tokens: DISPATCH.tokensPer10s,
      refilledAt: Date.now(),
      queue: [],
      inflight: {},
      paidStreak: 0,
      breakers: {},
    };
    return this.#state;
  }

  async #save(): Promise<void> {
    await this.ctx.storage.put("state", this.#state);
  }

  #refill(state: State, now: number): void {
    state.tokens = Math.min(
      DISPATCH.tokensPer10s,
      state.tokens + (now - state.refilledAt) * REFILL_PER_MS,
    );
    state.refilledAt = now;
  }

  #prune(state: State, now: number): void {
    state.queue = state.queue.filter((w) => now - w.seenAt <= STALE_WAITING_MS);
    for (const [ticketId, at] of Object.entries(state.inflight))
      if (now - at > STALE_INFLIGHT_MS) delete state.inflight[ticketId];
  }

  /** `model` is what the ticket will call; granting it claims a half-open breaker's probe. */
  async acquire(ticketId: string, priority: Priority, model?: string): Promise<Grant> {
    const state = await this.#load();
    const now = Date.now();
    if (state.inflight[ticketId] !== undefined) return { granted: true };
    const waiting = state.queue.find((w) => w.ticketId === ticketId);
    if (waiting) waiting.seenAt = now;
    this.#refill(state, now);
    this.#prune(state, now);
    if (!state.queue.some((w) => w.ticketId === ticketId))
      state.queue.push({ ticketId, priority, enqueuedAt: now, seenAt: now });
    const order = grantOrder(state.queue, state.paidStreak);
    const capacity = Math.min(
      Math.floor(state.tokens),
      DISPATCH.maxInFlight - Object.keys(state.inflight).length,
    );
    const index = order.findIndex((w) => w.ticketId === ticketId);
    if (index < capacity) {
      state.queue = state.queue.filter((w) => w.ticketId !== ticketId);
      state.inflight[ticketId] = now;
      state.tokens -= 1;
      state.paidStreak = priority === "paid" ? state.paidStreak + 1 : 0;
      const breaker = model === undefined ? undefined : state.breakers[model];
      if (breaker && this.#halfOpen(breaker, now)) breaker.probeAt = now;
      await this.#save();
      return { granted: true };
    }
    await this.#save();
    return { granted: false, position: index + 1 };
  }

  async release(ticketId: string): Promise<void> {
    const state = await this.#load();
    delete state.inflight[ticketId];
    state.queue = state.queue.filter((w) => w.ticketId !== ticketId);
    await this.#save();
  }

  /** Cooldown over and no probe in flight: the next call to this model is the probe. */
  #halfOpen(breaker: Breaker, now: number): boolean {
    if (breaker.openedAt === null || now < breaker.openedAt + DISPATCH.breakerCooldownMs)
      return false;
    return breaker.probeAt === null || now - breaker.probeAt >= STALE_INFLIGHT_MS;
  }

  /**
   * The models a job may plan with now. A half-open model is allowed but not claimed here: the
   * probe is spent only when a slot is granted for it (`acquire`), so a fallback that a job merely
   * planned does not keep the breaker open.
   */
  async allowModels(models: string[]): Promise<string[]> {
    const state = await this.#load();
    const now = Date.now();
    return models.filter((model) => {
      const breaker = state.breakers[model];
      return !breaker || breaker.openedAt === null || this.#halfOpen(breaker, now);
    });
  }

  /** Spec 8.3: alerts never get in the way of dispatching. */
  async #announce(model: string, open: boolean, now: number): Promise<void> {
    try {
      await breakerChanged(this.env, model, open, now);
    } catch {}
  }

  async report(model: string, ok: boolean): Promise<void> {
    const state = await this.#load();
    const now = Date.now();
    state.breakers[model] ??= { outcomes: [], openedAt: null, probeAt: null };
    const breaker = state.breakers[model];
    if (breaker.openedAt !== null) {
      if (breaker.probeAt === null) return; // a straggler from before the breaker opened
      if (ok) state.breakers[model] = { outcomes: [], openedAt: null, probeAt: null };
      else {
        breaker.openedAt = now;
        breaker.probeAt = null;
      }
      await this.#save();
      // A failed probe re-opens a breaker that is already open: only the close is news.
      if (ok) await this.#announce(model, false, now);
      return;
    }
    breaker.outcomes.push(ok);
    if (breaker.outcomes.length > DISPATCH.breakerWindow) breaker.outcomes.shift();
    const failures = breaker.outcomes.filter((outcome) => !outcome).length;
    if (
      breaker.outcomes.length >= MIN_BREAKER_SAMPLES &&
      failures / breaker.outcomes.length > DISPATCH.breakerFailRate
    ) {
      breaker.openedAt = now;
      breaker.probeAt = null;
      await this.#save();
      await this.#announce(model, true, now);
      return;
    }
    await this.#save();
  }
}
