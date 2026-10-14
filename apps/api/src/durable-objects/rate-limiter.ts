import { DurableObject } from "cloudflare:workers";

export const utcDay = (ms: number) => Math.floor(ms / 86_400_000);

type Hold = { day: number; committed: boolean; weight?: number };
/** `claim`: one holder per window, e.g. the sign-up bonus of a device or IP segment. */
type State = {
  hits: number[];
  holds: Record<string, Hold>;
  claim?: { nonce: string; until: number };
};

/**
 * One object per counted key (`rate:jobs:<visitor>`, `quota:ip:<segment>`, …). Request limits use
 * a sliding log; the daily free quota uses holds that are reserved when a job is created and
 * committed or released when it ends (spec 5.2), keyed by the job id so retries are idempotent.
 */
export class RateLimiter extends DurableObject {
  #state: State | undefined;

  async #load(): Promise<State> {
    this.#state ??= (await this.ctx.storage.get<State>("state")) ?? { hits: [], holds: {} };
    return this.#state;
  }

  async #save(): Promise<void> {
    await this.ctx.storage.put("state", this.#state);
  }

  #usedOn(state: State, day: number): number {
    let sum = 0;
    for (const hold of Object.values(state.holds)) if (hold.day === day) sum += hold.weight ?? 1;
    return sum;
  }

  /** Drops holds from before yesterday; yesterday's stay so a late commit or release finds them. */
  #prune(state: State, today: number): void {
    for (const [nonce, hold] of Object.entries(state.holds))
      if (hold.day < today - 1) delete state.holds[nonce];
  }

  async hit(limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const state = await this.#load();
    const now = Date.now();
    state.hits = state.hits.filter((at) => at > now - windowMs);
    const oldest = state.hits[0];
    if (state.hits.length >= limit && oldest !== undefined) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }
    state.hits.push(now);
    await this.#save();
    return { allowed: true, retryAfterSec: 0 };
  }

  /** `weight` counts the hold as that many units (credits for the daily spend cap). */
  async reserve(
    nonce: string,
    limit: number,
    weight = 1,
  ): Promise<{ allowed: boolean; used: number }> {
    const state = await this.#load();
    const today = utcDay(Date.now());
    this.#prune(state, today);
    const used = this.#usedOn(state, today);
    if (state.holds[nonce]) return { allowed: true, used };
    if (used + weight > limit) return { allowed: false, used };
    state.holds[nonce] = { day: today, committed: false, weight };
    await this.#save();
    return { allowed: true, used: used + weight };
  }

  /** A smaller `weight` than reserved keeps only that much counted (the delivered tier). */
  async commit(nonce: string, weight?: number): Promise<void> {
    const state = await this.#load();
    const hold = state.holds[nonce];
    if (!hold) return;
    if (hold.committed && (weight === undefined || hold.weight === weight)) return;
    if (weight !== undefined) hold.weight = weight;
    hold.committed = true;
    await this.#save();
  }

  async release(nonce: string): Promise<void> {
    const state = await this.#load();
    if (!state.holds[nonce]) return;
    delete state.holds[nonce];
    await this.#save();
  }

  /**
   * Makes sure today has at least `count` committed uses keyed `${prefix}#0…`. Used when a guest
   * signs in (spec 5.1): repeating it, or calling it again with a higher count, adds only the gap.
   */
  async absorb(prefix: string, count: number): Promise<void> {
    const state = await this.#load();
    const today = utcDay(Date.now());
    this.#prune(state, today);
    let changed = false;
    for (let i = 0; i < count; i++) {
      const nonce = `${prefix}#${i}`;
      if (state.holds[nonce]) continue;
      state.holds[nonce] = { day: today, committed: true };
      changed = true;
    }
    if (changed) await this.#save();
  }

  /**
   * Takes this key's single slot for `windowMs` (spec 5.4: one sign-up bonus per device and per IP
   * segment every 30 days). Repeating with the same nonce keeps it; another nonce is refused.
   */
  async claim(nonce: string, windowMs: number): Promise<boolean> {
    const state = await this.#load();
    const now = Date.now();
    if (state.claim && state.claim.until > now) return state.claim.nonce === nonce;
    state.claim = { nonce, until: now + windowMs };
    await this.#save();
    return true;
  }

  async unclaim(nonce: string): Promise<void> {
    const state = await this.#load();
    if (state.claim?.nonce !== nonce) return;
    delete state.claim;
    await this.#save();
  }

  async used(): Promise<number> {
    const state = await this.#load();
    return this.#usedOn(state, utcDay(Date.now()));
  }
}
