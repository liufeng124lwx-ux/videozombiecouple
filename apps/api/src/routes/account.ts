import type { StoryId } from "@vzc/catalog";
import {
  type AccountView,
  DeleteAccountSchema,
  type LedgerEntryView,
  SetPasswordSchema,
} from "@vzc/contracts";
import type { Context } from "hono";
import { fail } from "../http.ts";
import { deleteAccount } from "../services/delete-account.ts";
import { hashPassword } from "../services/password.ts";
import { endSession } from "../services/session.ts";
import { userById } from "../services/users.ts";
import type { AppEnv } from "../types.ts";

/** The signed-in user id, or null (the caller answers UNAUTHORIZED). */
export function requireUser(c: Context<AppEnv>): string | null {
  return c.get("userId");
}

/** Sets or replaces the password; also the "forgot password" path after a code sign-in. */
export async function setPassword(c: Context<AppEnv>) {
  const userId = requireUser(c);
  if (!userId) return fail(c, "UNAUTHORIZED");
  // A guest checkout account is anyone's typed address until its owner proves the email.
  if (!(await userById(c.env.DB, userId))?.verified) return fail(c, "FORBIDDEN");
  const parsed = SetPasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "WEAK_PASSWORD");
  await c.env.DB.prepare("UPDATE users SET password_hash=? WHERE id=?")
    .bind(await hashPassword(parsed.data.password), userId)
    .run();
  return c.json({ ok: true });
}

const PAGE = 20;

export async function account(c: Context<AppEnv>) {
  const userId = requireUser(c);
  if (!userId) return fail(c, "UNAUTHORIZED");
  const user = await userById(c.env.DB, userId);
  if (!user) return fail(c, "UNAUTHORIZED");
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(userId));
  const view: AccountView = {
    email: user.email,
    verified: user.verified,
    hasPassword: user.hasPassword,
    google: user.googleSub !== null,
    createdAt: user.createdAt,
    balance: await wallet.balance(userId),
  };
  c.header("cache-control", "no-store");
  return c.json(view);
}

/** Spec 5.5: 20 rows a page, newest first. Zero rows (a reservation turning final) are hidden. */
export async function ledger(c: Context<AppEnv>) {
  const userId = requireUser(c);
  if (!userId) return fail(c, "UNAUTHORIZED");
  const before = Number(c.req.query("before") ?? Number.MAX_SAFE_INTEGER);
  const { results } = await c.env.DB.prepare(
    "SELECT l.id AS id, l.delta AS delta, l.type AS type, l.reason AS reason, l.job_id AS job_id, l.order_id AS order_id, l.created_at AS created_at, s.story AS story FROM credit_ledger l LEFT JOIN stories s ON s.id=l.job_id WHERE l.user_id=? AND l.delta<>0 AND l.id<? ORDER BY l.id DESC LIMIT ?",
  )
    .bind(userId, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, PAGE + 1)
    .all<{
      id: number;
      delta: number;
      type: string;
      reason: string | null;
      job_id: string | null;
      order_id: string | null;
      created_at: number;
      story: string | null;
    }>();
  const page = results.slice(0, PAGE);
  const entries: LedgerEntryView[] = page.map((row) => ({
    id: row.id,
    delta: row.delta,
    type: row.type,
    reason: row.reason,
    jobId: row.job_id,
    orderId: row.order_id,
    ...(row.story ? { story: row.story as StoryId } : {}),
    createdAt: row.created_at,
  }));
  c.header("cache-control", "no-store");
  return c.json({
    entries,
    next: results.length > PAGE ? (page[page.length - 1]?.id ?? null) : null,
  });
}

/** Spec 5.5: one confirmation; live subscriptions are cancelled first. */
export async function removeAccount(c: Context<AppEnv>) {
  const userId = requireUser(c);
  if (!userId) return fail(c, "UNAUTHORIZED");
  const parsed = DeleteAccountSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  // Spec 5.5: a live subscription is cancelled first, so nobody is billed for a deleted account.
  const live = await c.env.DB.prepare(
    "SELECT 1 AS live FROM subscriptions WHERE user_id=? AND status IN ('active','past_due') LIMIT 1",
  )
    .bind(userId)
    .first();
  if (live) return fail(c, "SUBSCRIPTION_ACTIVE");
  await deleteAccount(c.env, userId);
  await endSession(c);
  return c.json({ ok: true });
}
