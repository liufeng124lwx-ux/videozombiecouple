import type { Dispatcher } from "./durable-objects/dispatcher.ts";
import type { JobRunner } from "./durable-objects/job-runner.ts";
import type { RateLimiter } from "./durable-objects/rate-limiter.ts";
import type { Wallet } from "./durable-objects/wallet.ts";

export interface Bindings {
  DB: D1Database;
  KV: KVNamespace;
  BUCKET: R2Bucket;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
  DISPATCHER: DurableObjectNamespace<Dispatcher>;
  JOB_RUNNER: DurableObjectNamespace<JobRunner>;
  WALLET: DurableObjectNamespace<Wallet>;
  ANALYTICS?: AnalyticsEngineDataset;
  /** https://videozombiecouple.com (staging: https://staging.videozombiecouple.com). */
  ALLOWED_ORIGIN: string;
  /** Which deployment this is; account-wide checks (the kie balance reconcile) run only in production. */
  ENVIRONMENT?: "staging" | "production";
  /** This Worker's own origin, used in kie callback URLs. */
  API_ORIGIN: string;
  /** .videozombiecouple.com, so the visitor cookie is shared with the site. */
  COOKIE_DOMAIN: string;
  /** Secret for identity hashes and callback signatures. */
  HMAC_KEY: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_HOSTNAME: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  KIE_API_KEY: string;
  /** Cloudflare send_email binding; mail is skipped when absent (local runs). */
  EMAIL?: {
    send(message: {
      to: string;
      from: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<unknown>;
  };
  EMAIL_FROM?: string;
  /** Google sign-in is off unless both are set. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Waffo Pancake (spec 6.1): payments are off unless mode, merchant, key and store are set. */
  WAFFO_MODE?: string;
  WAFFO_MERCHANT_ID?: string;
  WAFFO_PRIVATE_KEY?: string;
  /** The store's short id and its UUID, comma-separated (webhooks may carry either). */
  WAFFO_STORE_ID?: string;
  /** JSON { productKey: "PROD_…" }. */
  WAFFO_PRODUCTS?: string;
  /** Overrides the platform webhook key (tests only). */
  WAFFO_WEBHOOK_PUBLIC_KEY?: string;
  /** Server-side GA4 purchase events (spec 9); skipped unless both are set. */
  GA4_MEASUREMENT_ID?: string;
  GA4_API_SECRET?: string;
  /** "1" swaps kie for the scriptable FakeAdapter (spec 11.1). */
  FAKE_PROVIDER?: string;
  /** JSON Record<model, FakeStep[]> for FAKE_PROVIDER runs. */
  FAKE_SCRIPT?: string;
  /** Spec 8.3 alerts: Telegram first, email copy; each is skipped when not set. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ALERT_EMAIL?: string;
  /** Plan 7C end-to-end runs only (see local.ts); never set in a deployed config. */
  LOCAL_DEV?: string;
  /** Spec 8.4: errors go to Sentry once this is set. */
  SENTRY_DSN?: string;
  /** Staging only: lets the post-deploy smoke script past the human check (human-pass.ts). */
  SMOKE_KEY?: string;
  /** Production only: read-only analytics token for the weekly Cloudflare usage report. */
  CF_ANALYTICS_TOKEN?: string;
  /** Spec 8.1: Cloudflare Access in front of /admin; the admin is off unless all three are set. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Comma-separated admin emails. */
  ADMIN_EMAILS?: string;
}

export interface Variables {
  requestId: string;
  visitorId: string;
  visitorHash: string;
  /** null when the browser sent no usable x-device header. */
  fpHash: string | null;
  ipSegment: string;
  ipSegmentHash: string;
  /** Who owns jobs created by this request: `g:<visitorHash>` for guests (plan 3 adds `u:<id>`). */
  owner: string;
  /** `g:<visitorHash>`: this browser's guest identity, kept after sign-in for its own jobs. */
  guestOwner: string;
  /** Signed-in account, or null for guests. */
  userId: string | null;
  /** The free-tier cost breaker is open: free jobs get FREE_TIER_PAUSED (spec 4.2). */
  freePaused: boolean;
  /** Paid jobs are paused by the daily budget or an admin: credit charges get PAUSED (cost guardrails spec 3). */
  paidPaused: boolean;
  /** Set on /admin requests that passed Access and the admin list. */
  adminEmail: string;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
