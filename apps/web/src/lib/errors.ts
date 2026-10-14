type Sdk = {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown): unknown;
  dedupeIntegration?: () => unknown;
};
type Loader = () => Promise<Sdk>;
/** One error loop (a throwing animation frame) must not burn Sentry's quota. */
const MAX_REPORTS = 20;

const defaultLoad: Loader = () => import("./sentry-sdk.ts") as unknown as Promise<Sdk>;

/**
 * Spec 8.4 / plan 7C: a tiny catcher on every page. The Sentry SDK (~25 KB) loads only after the
 * first error, then gets every error caught so far. Errors only: no tracing, no default PII, and
 * no default integrations (they would add their own listeners and breadcrumbs with URLs).
 * Returns a remover, or null when no DSN is configured.
 */
export function installErrorCatcher(
  load: Loader = defaultLoad,
  dsn: string | undefined = import.meta.env.PUBLIC_SENTRY_DSN,
): (() => void) | null {
  if (!dsn) return null;
  const queue: unknown[] = [];
  let sdk: Sdk | null = null;
  let loading = false;
  let reports = 0;
  const take = (error: unknown) => {
    if (++reports > MAX_REPORTS) return;
    if (sdk) {
      sdk.captureException(error);
      return;
    }
    queue.push(error);
    if (loading) return;
    loading = true;
    load()
      .then((loaded) => {
        loaded.init({
          dsn,
          environment: import.meta.env.PUBLIC_DEPLOY_ENV ?? "preview",
          sendDefaultPii: false,
          tracesSampleRate: 0,
          defaultIntegrations: false,
          // Drops repeats of the same error; adds no page data (sentry-sdk.ts).
          integrations: loaded.dedupeIntegration ? [loaded.dedupeIntegration()] : [],
          // The page without its query string, so events stay debuggable without leaking links.
          initialScope: { tags: { path: location.pathname } },
        });
        sdk = loaded;
        for (const queued of queue.splice(0)) loaded.captureException(queued);
      })
      .catch(() => {});
  };
  const onError = (event: Event) => {
    const e = event as ErrorEvent;
    take(e.error ?? e.message);
  };
  const onRejection = (event: Event) => take((event as Event & { reason?: unknown }).reason);
  addEventListener("error", onError);
  addEventListener("unhandledrejection", onRejection);
  return () => {
    removeEventListener("error", onError);
    removeEventListener("unhandledrejection", onRejection);
  };
}
