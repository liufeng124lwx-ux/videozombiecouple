import { runCron } from "./ops/cron.ts";
import { app } from "./router.ts";
import type { Bindings } from "./types.ts";

export { Dispatcher } from "./durable-objects/dispatcher.ts";
export { JobRunner } from "./durable-objects/job-runner.ts";
export { RateLimiter } from "./durable-objects/rate-limiter.ts";
export { Wallet } from "./durable-objects/wallet.ts";

export default {
  fetch: app.fetch,
  /** Spec 8.2: the ops schedule (wrangler triggers.crons). */
  scheduled(controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runCron(controller.cron, env, controller.scheduledTime, undefined, ctx));
  },
} satisfies ExportedHandler<Bindings>;
