export type Consent = "granted" | "denied";

const COOKIE = "upx_consent";
const MAX_AGE_SECONDS = 180 * 86_400;

export function storedConsent(): Consent | null {
  const value = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return value === "granted" || value === "denied" ? value : null;
}

export function saveConsent(choice: Consent): void {
  document.cookie = `${COOKIE}=${choice}; Max-Age=${MAX_AGE_SECONDS}; Path=/; SameSite=Lax`;
}

/** Spec 7.5: EU/EEA/UK/CH visitors start opted out; everyone else starts opted in. */
export function effectiveConsent(stored: Consent | null, required: boolean): Consent {
  return stored ?? (required ? "denied" : "granted");
}

export function needsBanner(stored: Consent | null, required: boolean): boolean {
  return required && stored === null;
}
