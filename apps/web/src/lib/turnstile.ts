interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<void> | null = null;
let widget: string | null = null;

/** Loads Cloudflare Turnstile on first use; rejects when it is blocked or does not load in time. */
export function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error("CHALLENGE_REQUIRED"));
    };
    const timer = setTimeout(fail, 15_000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve();
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * A Turnstile token for one protected action (the API checks the action name: "login" or "job").
 * The widget stays invisible unless Cloudflare needs the person to tick a box.
 */
export async function getToken(
  container: HTMLElement,
  action: "login" | "job",
  signal?: AbortSignal,
): Promise<string> {
  const siteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY ?? "";
  if (!siteKey) throw new Error("CHALLENGE_REQUIRED");
  await loadTurnstile();
  signal?.throwIfAborted();
  if (widget !== null) window.turnstile?.remove(widget);
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (widget !== null) window.turnstile?.remove(widget);
      widget = null;
      if (token) resolve(token);
      else reject(new Error("CHALLENGE_REQUIRED"));
    };
    const abort = () => finish();
    const timer = setTimeout(() => finish(), 120_000);
    signal?.addEventListener("abort", abort, { once: true });
    widget =
      window.turnstile?.render(container, {
        sitekey: siteKey,
        action,
        execution: "execute",
        appearance: "interaction-only",
        size: "flexible",
        retry: "never",
        "refresh-expired": "never",
        callback: (token: string) => finish(token),
        "error-callback": () => {
          finish();
          return true;
        },
        "expired-callback": () => finish(),
        "timeout-callback": () => finish(),
      }) ?? null;
    if (widget === null) finish();
    else window.turnstile?.execute(widget);
  });
}
