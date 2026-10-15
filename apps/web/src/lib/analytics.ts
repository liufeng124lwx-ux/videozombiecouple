import type { CommonEventProps, EventName, MeView } from "@vzc/contracts";
import type { Consent } from "./consent.ts";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: ((...args: unknown[]) => void) & { q?: unknown[] };
  }
}

export type AnalyticsIds = { ga4: string; clarity: string };
type Props = Record<string, string | number | boolean>;

const envIds = (): AnalyticsIds => ({
  ga4: import.meta.env.PUBLIC_GA4_ID ?? "",
  clarity: import.meta.env.PUBLIC_CLARITY_ID ?? "",
});

let context: CommonEventProps | null = null;
let granted = false;
let gaLoaded = false;
let clarityLoaded = false;

function loadScript(src: string): void {
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

export function userKind(me: MeView | null): CommonEventProps["user_kind"] {
  if (!me?.user) return "guest";
  return me.paid ? "paid" : "free";
}

function loadGa(consent: Consent, ids: AnalyticsIds): void {
  if (!ids.ga4 || gaLoaded) return;
  gaLoaded = true;
  window.dataLayer = window.dataLayer ?? [];
  // gtag.js reads the arguments object itself, so this must not be an arrow function.
  window.gtag = function gtag() {
    window.dataLayer?.push(arguments);
  };
  window.gtag("consent", "default", {
    analytics_storage: consent,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  window.gtag("js", new Date());
  window.gtag("config", ids.ga4);
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga4)}`);
}

/**
 * Spec 7.5 / 9, legal review 2026-10-15: GA4 loads only once analytics are allowed (by default
 * outside the consent countries, after Accept inside them: no cookieless pings first). Clarity
 * records sessions, so it waits for an explicit yes everywhere. No IDs means no scripts.
 */
export function startAnalytics(
  next: CommonEventProps,
  consent: Consent,
  ids: AnalyticsIds = envIds(),
  { explicit = false }: { explicit?: boolean } = {},
): void {
  context = next;
  applyConsent(consent, ids, { explicit });
}

export function applyConsent(
  consent: Consent,
  ids: AnalyticsIds = envIds(),
  { explicit = false }: { explicit?: boolean } = {},
): void {
  granted = consent === "granted";
  if (granted) loadGa(consent, ids);
  window.gtag?.("consent", "update", { analytics_storage: consent });
  if (granted && explicit && ids.clarity && !clarityLoaded) {
    clarityLoaded = true;
    const queue: unknown[] = [];
    const clarity = function clarity() {
      queue.push(arguments);
    } as ((...args: unknown[]) => void) & { q?: unknown[] };
    clarity.q = queue;
    window.clarity = clarity;
    loadScript(`https://www.clarity.ms/tag/${encodeURIComponent(ids.clarity)}`);
  }
}

/** Spec 9: every event carries lang, page_id and user_kind; nothing is sent without consent. */
export function track(event: EventName, props: Props = {}): void {
  if (!granted || !context || !window.gtag) return;
  window.gtag("event", event, { ...context, ...props });
}

/** "GA1.1.123.456" → "123.456": joins the server-side purchase event to this browser (spec 9). */
export function gaClientId(): string | undefined {
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith("_ga="))
    ?.slice(4);
  const parts = raw?.split(".") ?? [];
  return parts.length >= 4 ? `${parts[2]}.${parts[3]}` : undefined;
}

export function resetAnalytics(): void {
  context = null;
  granted = false;
  gaLoaded = false;
  clarityLoaded = false;
  delete window.dataLayer;
  delete window.gtag;
  delete window.clarity;
  for (const script of document.head.querySelectorAll("script[src]")) script.remove();
}
