/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_DEPLOY_ENV?: string;
  readonly PUBLIC_SITE_ORIGIN?: string;
  readonly PUBLIC_API_ORIGIN?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_GA4_ID?: string;
  readonly PUBLIC_CLARITY_ID?: string;
  readonly PUBLIC_ADS_ENABLED?: string;
  /** Spec 8.4: the browser Sentry project's DSN (public by design). */
  readonly PUBLIC_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
