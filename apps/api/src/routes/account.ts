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
    "SELECT id, delta, type, reason, job_id, order_id, created_at FROM credit_ledger WHERE user_id=? AND delta<>0 AND id<? ORDER BY id DESC LIMIT ?",
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
    }>();
  const page = results.slice(0, PAGE);
  const entries: LedgerEntryView[] = page.map((row) => ({
    id: row.id,
    delta: row.delta,
    type: row.type,
    reason: row.reason,
    jobId: row.job_id,
    orderId: row.order_id,
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
