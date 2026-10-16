// Shared money helpers for the Christmas eval scripts (christmas content spec §5).
// Estimates come before any call; real spend is the KIE credit balance before minus after.
import { KieError, USD_PER_CREDIT } from "./kie.ts";

/** GPT Image 2 image-to-image / text-to-image, 1K (docs/model-eval.md). */
export const IMAGE_USD = 0.015;
/** The describe route's budgeted cost per call (catalog ROUTES, describe rank 1). */
export const DESCRIBE_USD = 0.001;
/** Model cost target of one Christmas film: 11 keyframes + 25 s of shots + describe (global constraints). */
export const FILM_USD = 1.92;
/** Kling 3.0 std, no sound, per second (eval candidates). */
export const KLING_USD_PER_SEC = 0.07;

export const estimateKeyframes = ({ pairs, scenes }: { pairs: number; scenes: number }) =>
  pairs * scenes * 11 * IMAGE_USD + pairs * DESCRIBE_USD;
export const estimateFilms = (n: number) => n * FILM_USD;

/** All estimates in one place for the scripts' plans. */
export const estimate = { keyframes: estimateKeyframes, films: estimateFilms, image: IMAGE_USD, describe: DESCRIBE_USD, klingPerSec: KLING_USD_PER_SEC };

export const QUOTA_MESSAGE = "额度已到，等一小时后用 `--resume` 继续";

/** KIE 433: the key's hourly quota. Also matches a runner JobFailed that wrapped it ("code=433"). */
export function isQuotaError(e: unknown): boolean {
  if (e instanceof KieError) return e.code === 433;
  return /\bcode=433\b/.test(String((e as Error)?.message ?? e));
}

export function creditFrom(body: unknown): number | null {
  const j = body as { code?: unknown; data?: unknown } | null;
  return j && j.code === 200 && typeof j.data === "number" ? j.data : null;
}

/** KIE balance in credits, or null when unavailable. The key goes only into the header. */
export async function credit(key: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl("https://api.kie.ai/api/v1/chat/credit", { headers: { Authorization: `Bearer ${key}` } });
    return creditFrom(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

export function measured(before: number | null, after: number | null): number | null {
  return before === null || after === null ? null : (before - after) * USD_PER_CREDIT;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** Reads the balance now; `end()` reads it again and prints what the run really cost. */
export async function meter(key: string, log: (s: string) => void = console.log) {
  const before = await credit(key);
  log(before === null ? "credit balance unavailable at start" : `credits at start: ${before}`);
  return {
    before,
    async end() {
      const after = await credit(key);
      const spent = measured(before, after);
      log(spent === null ? "credit balance unavailable; spend not measured" : `credits ${before} -> ${after}: spent $${spent.toFixed(4)}`);
      return spent;
    },
  };
}
