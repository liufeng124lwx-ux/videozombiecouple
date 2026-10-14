import { SPEND_CAPS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { limiter } from "./limits.ts";

const DAY = 86_400_000;

export const spendCounter = (userId: string) => `spend:user:${userId}`;

/** Cost guardrails spec 4: the admin's number, else the new-payer or regular daily cap. */
export async function dailyCreditCap(env: Bindings, userId: string, now: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT u.daily_credit_cap AS cap,
            (SELECT MIN(created_at) FROM orders WHERE user_id = u.id AND status = 'paid') AS firstPaid
       FROM users u WHERE u.id = ?`,
  )
    .bind(userId)
    .first<{ cap: number | null; firstPaid: number | null }>();
  if (row?.cap != null) return row.cap;
  const established =
    row?.firstPaid != null && now - row.firstPaid >= SPEND_CAPS.newPayerDays * DAY;
  return established ? SPEND_CAPS.dailyCredits : SPEND_CAPS.newPayerDailyCredits;
}

export async function reserveSpend(
  env: Bindings,
  userId: string,
  nonce: string,
  credits: number,
  cap: number,
): Promise<boolean> {
  return (await limiter(env, spendCounter(userId)).reserve(nonce, cap, credits)).allowed;
}
