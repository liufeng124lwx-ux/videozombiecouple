import type { Context } from "hono";
import { Toucan } from "toucan-js";
import type { AppEnv, Bindings } from "../types.ts";

const SECRET_QUERY = /((?:X-Amz-[A-Za-z-]+|sig|token|code)=)[^&\s"']*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Signed-link parameters, tokens and email addresses never leave the Worker (plan 7C). */
export function scrub(text: string): string {
  return text.replace(SECRET_QUERY, "$1[removed]").replace(EMAIL, "[email]");
}

type Extra = { requestId?: string; path?: string; userId?: string | null; task?: string };
type Waiter = { waitUntil(promise: Promise<unknown>): void };

/**
 * Spec 8.4: errors to Sentry, without the request (no cookies, headers, body or query string).
 * Does nothing until SENTRY_DSN is set.
 */
export function report(env: Bindings, error: unknown, extra: Extra = {}, context?: Waiter): void {
  if (!env.SENTRY_DSN) return;
  try {
    const sentry = new Toucan({
      dsn: env.SENTRY_DSN,
      environment: env.API_ORIGIN,
      sampleRate: 1,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      ...(context ? { context: context as never } : {}),
    });
    if (extra.requestId) sentry.setTag("requestId", extra.requestId);
    if (extra.task) sentry.setTag("task", extra.task);
    if (extra.path) sentry.setExtra("path", extra.path);
    if (extra.userId) sentry.setUser({ id: extra.userId });
    const clean = new Error(scrub(error instanceof Error ? error.message : String(error)));
    if (error instanceof Error) {
      clean.name = error.name;
      if (error.stack) clean.stack = scrub(error.stack);
    }
    sentry.captureException(clean);
  } catch {
    // Reporting must never be the second failure.
  }
}

export function reportRequest(c: Context<AppEnv>, error: unknown): void {
  let context: Waiter | undefined;
  try {
    context = c.executionCtx;
  } catch {
    context = undefined; // app.request in tests has no execution context
  }
  report(
    c.env,
    error,
    {
      requestId: c.get("requestId"),
      path: new URL(c.req.url).pathname,
      userId: c.get("userId") ?? null,
    },
    context,
  );
}
