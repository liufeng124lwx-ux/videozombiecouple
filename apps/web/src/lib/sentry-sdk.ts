// Only what errors.ts calls, so the lazy chunk tree-shakes to the core (no replay, no tracing).
export { captureException, dedupeIntegration, init } from "@sentry/browser";
