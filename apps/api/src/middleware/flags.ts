import { CAPABILITY_IDS, type CapabilityId } from "@vzc/catalog";
import type { Banner } from "@vzc/contracts";
import { createMiddleware } from "hono/factory";
import { fail } from "../http.ts";
import type { AppEnv } from "../types.ts";

export type Flags = {
  paused: boolean;
  /** Who paused processing: the admin, or the kie key's daily cap (which lifts at 00:00 UTC). */
  pausedBy: "admin" | "kie-cap" | null;
  pausedAt: number | null;
  freePaused: boolean;
  /** Who paused the free tier: ops lifts only its own pause (spec 4.2). */
  freePausedBy: "ops" | "admin" | null;
  /** Paid jobs are paused by the daily budget (ops) or an admin; only an admin resumes them. */
  paidPaused: boolean;
  paidPausedBy: "ops" | "admin" | null;
  paidPausedAt: number | null;
  /** An admin's limit for one UTC day (`day` is that day's 00:00 UTC in ms). */
  paidLimit: { day: number; usd: number } | null;
  banner: Banner | null;
  /** Spec 8.1: capabilities that take no new jobs; running ones finish. */
  offline: CapabilityId[];
};

const cache = new WeakMap<KVNamespace, Flags & { at: number }>();

/** Account and billing routes keep working while processing is paused. */
const ALWAYS_OPEN = ["/v1/me", "/v1/auth/", "/v1/billing/", "/v1/quota"];

/** `flags` in KV: the admin's global pause and the free-tier cost breaker (spec 4.2, 8.1). */
export async function readFlags(kv: KVNamespace): Promise<Flags> {
  const cached = cache.get(kv);
  if (cached && Date.now() - cached.at < 60_000) return cached;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse((await kv.get("flags")) ?? "{}") as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const flags: Flags = {
    paused: parsed.paused === true,
    pausedBy: parsed.pausedBy === "admin" || parsed.pausedBy === "kie-cap" ? parsed.pausedBy : null,
    pausedAt: typeof parsed.pausedAt === "number" ? parsed.pausedAt : null,
    freePaused: parsed.freePaused === true,
    freePausedBy:
      parsed.freePausedBy === "ops" || parsed.freePausedBy === "admin" ? parsed.freePausedBy : null,
    paidPaused: parsed.paidPaused === true,
    paidPausedBy:
      parsed.paidPausedBy === "ops" || parsed.paidPausedBy === "admin" ? parsed.paidPausedBy : null,
    paidPausedAt: typeof parsed.paidPausedAt === "number" ? parsed.paidPausedAt : null,
    paidLimit: parsePaidLimit(parsed.paidLimit),
    banner: parseBanner(parsed.banner),
    offline: Array.isArray(parsed.offline)
      ? parsed.offline.filter((id): id is CapabilityId =>
          (CAPABILITY_IDS as readonly unknown[]).includes(id),
        )
      : [],
  };
  cache.set(kv, { ...flags, at: Date.now() });
  return flags;
}

/** Story status stays readable while paused: in-flight stories (maybe charged) still show their result. */
function isJobRead(c: { req: { method: string; path: string } }): boolean {
  return (
    (c.req.method === "GET" || c.req.method === "HEAD") &&
    (c.req.path.startsWith("/v1/stories/") || c.req.path.startsWith("/v1/share/"))
  );
}

export const flags = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const current = await readFlags(c.env.KV);
    c.set("freePaused", current.freePaused);
    c.set("paidPaused", current.paidPaused);
    if (current.paused && !ALWAYS_OPEN.some((path) => c.req.path.startsWith(path)) && !isJobRead(c))
      return fail(c, "PAUSED");
    await next();
  });

/** After an admin write: the next request reads KV instead of the minute-old copy. */
export function forgetFlags(kv: KVNamespace): void {
  cache.delete(kv);
}

export function parsePaidLimit(value: unknown): { day: number; usd: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const { day, usd } = value as { day?: unknown; usd?: unknown };
  return typeof day === "number" && typeof usd === "number" && usd > 0 ? { day, usd } : null;
}

/** Only short text and same-site links, whatever the admin typed. */
function parseBanner(value: unknown): Banner | null {
  if (typeof value !== "object" || value === null) return null;
  const { text, href } = value as { text?: unknown; href?: unknown };
  if (typeof text !== "string" || text.trim() === "" || text.length > 160) return null;
  return {
    text: text.trim(),
    href: typeof href === "string" && /^\/(?!\/)/.test(href) ? href : null,
  };
}
