/** Spec 5.2. Guests are counted per cookie and per device fingerprint, each capped at guestDaily. */
export const QUOTA = { guestDaily: 2, userDaily: 4, ipSegmentDaily: 10 } as const;

/** Spec 3.2 / 7.2. */
export const FILE_LIMITS = {
  maxBytes: 20_000_000,
  maxMegapixels: 50,
  minShortEdge: 64,
  accept: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
} as const;

/** Spec 7.1. */
export const RATE_LIMITS = {
  guestJobsPerMinute: 5,
  userJobsPerMinute: 20,
  loginMailPerEmailHour: 5,
  loginMailPerIpHour: 20,
  codeMaxAttempts: 5,
  statusPerSecond: 5,
  passwordPerVisitorHour: 20,
  passwordPerEmailHour: 10,
  /** Code / link attempts; codes also die after codeMaxAttempts wrong guesses. */
  codeAttemptsPerEmailHour: 10,
  codeAttemptsPerIpHour: 30,
} as const;

/** Spec 3.7. */
export const FREE_RETRY = {
  perJob: 1,
  perIdentityDaily: 3,
  rateWindow: 20,
  rateMinJobs: 10,
  rateMax: 0.3,
  siteAlertRate: 0.15,
} as const;

/** Spec 3.7 defaults; recalibrate on real photos before launch (spec 11.3). */
export const GUARD_THRESHOLDS = {
  compositionMinCorrelation: 0.9,
  colorMaxDeltaE: 8,
  faceMaxShiftOfWidth: 0.2,
} as const;

/**
 * Spec 3.4. The first five are defaults to recalibrate on real photos before launch; the rest were
 * calibrated on the 38 eval images (motion vs focus 17/20, old photos 4/4, text 5/6, no false hits).
 */
export const DIAGNOSIS_THRESHOLDS = {
  alreadySharpScore: 75,
  portraitMinFaceArea: 0.05,
  lowResLongEdge: 800,
  faceTimeoutMs: 1500,
  /** MediaPipe face detections below this confidence are ignored. */
  faceMinConfidence: 0.5,
  analysisLongEdge: 512,
  /** Gradient structure-tensor coherence at or above this means motion blur. */
  motionAnisotropy: 0.35,
  /** Share of 16px blocks that are two-toned and high-contrast (letters on paper or a screen). */
  textBlockShare: 0.08,
  /** Share of pixels with a sepia cast (R ≥ G ≥ B, warm and muted). */
  sepiaShare: 0.9,
  /** sharpness = 100 · (log10(Laplacian variance + 1) − offset) / span, clamped to 0–100. */
  sharpnessLogOffset: 0.6,
  sharpnessLogSpan: 2.4,
} as const;

/** Spec 3.5. */
export const WORKSPACE_LIMITS = { maxVersions: 20, idbMaxBytes: 300_000_000 } as const;

/** Spec 1.3 / 4.1. */
export const RETENTION = { freeHours: 24, creditDays: 7, signedUrlSeconds: 3600 } as const;

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
} as const;

/** Spec 6.6: full refund for an untouched pack, or a new plan barely used, inside these windows. */
export const REFUND_POLICY = {
  packDays: 7,
  subscriptionDays: 7,
  subscriptionMaxUsedShare: 0.2,
} as const;

/** Design S16 / spec 10A.7: browser-only tools; the targets are the long-tail sizes people search. */
export const LOCAL_TOOLS = {
  compressGif: { maxFiles: 20, targetsKb: [256, 1024, 5120], defaultTargetKb: 1024 },
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

/** Spec 3.5 / 3.7: the workspace and the refine that runs in the browser. */
export const REFINE = {
  /** Gaussian sigma of the low-pass, as a share of the image's long edge (about 12 px at 2048). */
  lowPassSigmaOfLongEdge: 0.006,
  /** The full-resolution export is computed in tiles of this size. */
  exportTile: 1024,
  /** Display textures: long edge on phones / elsewhere; never above the GPU's MAX_TEXTURE_SIZE. */
  textureLongEdgePhone: 2048,
  textureLongEdgeDesktop: 4096,
  /** Restore brush radius in screen pixels, and the step of the [ and ] keys. */
  brushMin: 4,
  brushMax: 160,
  brushDefault: 40,
  brushStep: 4,
  /** 0 is a hard edge, 1 feathers all the way from the centre. */
  brushSoftnessDefault: 0.6,
  /** Undo steps kept: brush strokes, refine settings and version switches. */
  historyMax: 50,
  /** Versions kept for one photo; the oldest go first. */
  versionsMax: 20,
  /** Spec 3.5: and at most this many bytes of their full-size images (300 MB). */
  versionsBytesMax: 300 * 1024 * 1024,
  /** A lost WebGL context that hasn't come back after this long falls back to Canvas 2D. */
  lostContextMs: 3000,
  /** Spec 3.5: the workspace is saved this long after the last change. */
  saveDelayMs: 1500,
  /** Spec 3.8: the result is revealed over this long. */
  revealMs: 900,
  /** Largest zoom, in screen pixels per photo pixel; the + and − keys zoom by zoomStep. */
  zoomMax: 8,
  zoomStep: 1.25,
  /** The loupe shows the result this many times larger, in a circle this many CSS pixels wide. */
  loupeZoom: 2.5,
  loupeRadius: 95,
  /** Pressing this long without moving shows the original (touch). */
  longPressMs: 350,
  /** design §11 --mask: the brush overlay is yellow at this opacity. */
  maskTint: 0.48,
} as const;

/** Cost guardrails spec 3: daily model-spend lines per category; ops checks them every 5 minutes. */
export const BUDGETS = {
  /** Free jobs' spend that pauses free jobs until 00:00 UTC (spec 4.2). */
  free: { dailyUsd: 20 },
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
  newPayerDailyCredits: 300,
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
