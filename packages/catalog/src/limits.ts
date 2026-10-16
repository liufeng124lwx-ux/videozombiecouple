/** Spec 5.2. Guests are counted per cookie and per device fingerprint, each capped at guestDaily. */
/** No free generation (owner, 2026-10-15): the example films on the site are the preview. */
export const QUOTA = {} as const;

/** Spec 3.2 / 7.2. */
export const FILE_LIMITS = {
  maxBytes: 20_000_000,
  maxMegapixels: 50,
  /** Faces must be big enough for identity (spec §4.2 S0). */
  minShortEdge: 384,
  accept: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
} as const;

/** Spec 7.1. */
export const RATE_LIMITS = {
  guestJobsPerMinute: 5,
  userJobsPerMinute: 20,
  loginMailPerEmailHour: 5,
  /** Nobody's inbox gets more than this many sign-in emails a day, whoever asks. */
  loginMailPerEmailDay: 10,
  /** Stories one network (IP range) can start a day: each costs a photo check (container, SeeAPI). */
  storiesPerIpDay: 30,
  loginMailPerIpHour: 20,
  codeMaxAttempts: 5,
  statusPerSecond: 5,
  passwordPerVisitorHour: 20,
  passwordPerEmailHour: 10,
  /** Code / link attempts; codes also die after codeMaxAttempts wrong guesses. */
  codeAttemptsPerEmailHour: 10,
  codeAttemptsPerIpHour: 30,
} as const;

/**
 * Uploads 1 day, photos and keyframes 3 days for everyone. Films: 3 days for accounts that never
 * verified their email (bought without signing in), 30 days once verified (owner, 2026-10-15).
 */
export const RETENTION = {
  inputHours: 24,
  workDays: 3,
  guestFilmDays: 3,
  memberFilmDays: 30,
  signedUrlSeconds: 3600,
} as const;

/** A paid film can be made again once for free while its photos still exist. */
export const REMAKES_PER_FILM = 1;

/** Spec 4.2 / 3.7. */
export const DISPATCH = {
  tokensPer10s: 15,
  maxInFlight: 60,
  paidPerFree: 4,
  breakerWindow: 20,
  breakerFailRate: 0.5,
  breakerCooldownMs: 5 * 60_000,
} as const;

/** Spec 5.4 / 7.3. */
export const ABUSE = {
  /** One sign-up bonus per device fingerprint and per IP segment in this window. */
  bonusOncePerMs: 30 * 86_400_000,
  rejectionWindowMs: 86_400_000,
  /** More rejected jobs than this inside the window marks the account / device suspicious. */
  maxRejections: 5,
  /** How long a device mark lasts (accounts stay marked until an admin clears them). */
  suspiciousDeviceMs: 30 * 86_400_000,
  /**
   * The youngest estimated age a photo may show. The service is for adults (18+), but face age
   * estimates are off by ±5 years or more: a margin keeps teenagers out at the cost of asking some
   * young-looking adults for a clearer photo.
   */
  minEstimatedAge: 21,
} as const;

/** The service is for adults: uploaders and everyone in the photos. */
export const ADULT_AGE = 18;

/** Terms, "Report a video": a film shown without consent comes down this soon after a report. */
export const TAKEDOWN_HOURS = 48;

/**
 * Spec 6.6: full refund for an untouched pack, or a new plan barely used, inside these windows. An
 * unused pack gets 14 days everywhere: the EU/UK withdrawal period for content not yet supplied.
 */
export const REFUND_POLICY = {
  packDays: 14,
  subscriptionDays: 7,
  subscriptionMaxUsedShare: 0.2,
} as const;

/** Spec 7.5: EU, EEA, UK and Switzerland visitors see the cookie banner and start opted out. */
export const CONSENT_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
]);

/** Cost guardrails spec 3: daily model-spend lines per category; ops checks them every 5 minutes. */
export const BUDGETS = {
  /** Free jobs' spend that pauses free jobs until 00:00 UTC (spec 4.2). */
  free: { dailyUsd: 5 },
  /** Paid jobs pause at max(7-day daily average × avgFactor, floorUsd); only an admin resumes them. */
  paid: { avgFactor: 3, floorUsd: 30 },
  /** Chat turns; enforced once the chat workspace ships (live: false until then). */
  chat: { dailyUsd: 3, live: false },
  /** An early warning at this share of a line. */
  warnShare: 0.8,
} as const;

/** Cost guardrails spec 4: credits one account may spend per UTC day. */
export const SPEND_CAPS = {
  /** Accounts whose first paid order is under `newPayerDays` old, or who never paid. */
  newPayerDailyCredits: 100,
  newPayerDays: 7,
  dailyCredits: 1200,
} as const;

/** Cost guardrails spec 3: the daily limit set by hand on the production kie key (kie dashboard). */
export const KIE_KEY_DAILY_CAP_USD = 60;

/**
 * Cost guardrails spec 6: the UTC hour at which kie resets a key's daily limit. Assumed 0 (UTC
 * midnight); confirm in the staging drill (docs/runbooks/cost-guardrails.md §4) and set it here.
 */
export const KIE_KEY_RESET_UTC_HOUR = 0;

/** Spec 8.2 / 8.3: what the ops cron watches, and when it speaks up. */
export const OPS = {
  /** Same alert at most once in this window; "resolved" is sent once when it clears. */
  alertQuietMs: 60 * 60 * 1000,
  /** A capability fails too often: over this share of attempts in the window, with enough attempts. */
  failureWindowMs: 15 * 60 * 1000,
  failureRateMax: 0.2,
  failureMinAttempts: 10,
  /** Today's spend over this many times the 7-day daily average. */
  costSpikeFactor: 2,
  /** …and only once today's spend is real money: tiny staging amounts ($0.02 vs $0.00) are not a spike. */
  costSpikeMinUsd: 5,
  costLookbackDays: 7,
  /** kie balance under this many days of the 7-day average spend. */
  balanceDays: 5,
  /** Daily kie reconcile: a balance drop may differ from recorded spend by this share of the drop, and by at least this many USD. */
  reconcileShare: 0.1,
  reconcileMinUsd: 2,
  /** A job unfinished this many times its slowest possible run is stuck. */
  stuckFactor: 2,
  /** Health checks: Standard every hour, Pro every 6 hours; each gets this long to finish. */
  healthProEveryHours: 6,
  healthTimeoutMs: 180_000,
  healthPollMs: 5_000,
  /** Jobs older than this lose their visitor, IP and device hashes and their diagnosis. */
  anonymizeAfterDays: 90,
  /** A credit hold still open after this long, or a webhook unprocessed this long, is reported. */
  staleHoldMs: 60 * 60 * 1000,
  webhookStaleMs: 60 * 60 * 1000,
  /** Expired jobs cleaned per hourly run, so one run never times out. */
  cleanupBatch: 200,
  /** Weekly Cloudflare report: alert when a month of vzc's usage would cost more (list price). */
  cloudflareMonthlyUsdAlert: 30,
} as const;
