import { ApiError } from "./api.ts";

// Spec 7.1: after one passed check the API lets this browser skip Turnstile for 30 minutes. This
// only remembers when trying without a check is worth it; the API decides, and asks again if not.
const KEY = "vzc-human-until";
const WINDOW_MS = 28 * 60 * 1000;

export function canSkipCheck(now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) > now;
  } catch {
    return false;
  }
}

export function rememberPassedCheck(now = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(now + WINDOW_MS));
  } catch {}
}

export function forgetPassedCheck(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

/** Runs `run`, adding a Turnstile token when there is no fresh pass or the API asks for one. */
export async function withHumanCheck<T>(
  run: (headers: Record<string, string>) => Promise<T>,
  token: () => Promise<string>,
): Promise<T> {
  if (canSkipCheck()) {
    try {
      return await run({});
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "CHALLENGE_REQUIRED")) throw error;
      forgetPassedCheck();
    }
  }
  let value: string;
  try {
    value = await token();
  } catch {
    throw new ApiError("CHALLENGE_REQUIRED");
  }
  const result = await run({ "x-turnstile": value });
  rememberPassedCheck();
  return result;
}
