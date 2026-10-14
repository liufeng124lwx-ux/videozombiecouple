import { grantDueMonthly } from "../billing/monthly.ts";
import { replayPending } from "../billing/webhook.ts";
import { report } from "../services/sentry.ts";
import type { Bindings } from "../types.ts";
import { deliver, raise, type Send } from "./alerts.ts";
import { checkPaidBudget } from "./budgets.ts";
import { weeklyCloudflareReport } from "./cf-usage.ts";
import { cleanupExpired } from "./cleanup.ts";
import { checkBalance, checkCostSpike } from "./costs.ts";
import { refreshDisposable } from "./disposable.ts";
import { checkFailures } from "./failures.ts";
import { checkFreeTier } from "./free-tier.ts";
import { checkHealth } from "./health.ts";
import { liftKieCap } from "./kie-cap.ts";
import { checkOrders } from "./orders.ts";
import { anonymizeOld } from "./privacy.ts";
import { checkHolds, checkLedger, checkWebhooks } from "./reconcile.ts";
import { checkStuck } from "./stuck.ts";

export const CRONS = {
  fiveMinutes: "*/5 * * * *",
  hourly: "0 * * * *",
  daily: "30 3 * * *",
  weekly: "0 4 * * 1",
} as const;

type Task = (env: Bindings, now: number, send: Send) => Promise<void>;

export const SCHEDULE: Record<string, [string, Task][]> = {
  [CRONS.fiveMinutes]: [
    ["free-tier", checkFreeTier],
    ["failures", checkFailures],
    ["stuck", checkStuck],
    ["kie-cap", liftKieCap],
    ["paid-budget", checkPaidBudget],
  ],
  [CRONS.hourly]: [
    ["monthly-credits", async (env, now) => void (await grantDueMonthly(env, now))],
    // Spec 6.2: Waffo retries a failed delivery only 3 times; this keeps trying (up to 10).
    ["webhook-replay", async (env, now) => void (await replayPending(env, now))],
    ["cleanup", async (env, now) => void (await cleanupExpired(env, now))],
    ["cost-spike", checkCostSpike],
    ["health", checkHealth],
  ],
  [CRONS.daily]: [
    ["ledger", checkLedger],
    ["holds", checkHolds],
    ["webhooks", checkWebhooks],
    ["orders", checkOrders],
    ["kie-balance", (env, now, send) => checkBalance(env, now, send)],
    ["anonymize", async (env, now) => anonymizeOld(env, now)],
  ],
  [CRONS.weekly]: [
    ["disposable", async (env) => void (await refreshDisposable(env))],
    ["cloudflare-usage", (env, now, send) => weeklyCloudflareReport(env, now, send)],
  ],
};

/** Spec 8.2: each task on its own; one that throws raises an alert and the rest still run. */
export async function runCron(
  cron: string,
  env: Bindings,
  now: number,
  send: Send = deliver,
  /** The cron's execution context, so a Sentry report outlives the run (spec 8.4). */
  context?: { waitUntil(promise: Promise<unknown>): void },
): Promise<string[]> {
  const ran: string[] = [];
  for (const [name, task] of SCHEDULE[cron] ?? []) {
    try {
      await task(env, now, send);
      ran.push(name);
    } catch (error) {
      report(env, error, { task: name }, context);
      await raise(
        env,
        { key: `task:${name}`, title: `Ops task failed: ${name}`, detail: String(error) },
        now,
        send,
      ).catch(() => {});
    }
  }
  return ran;
}
