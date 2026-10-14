/** Design §12: dates and times in the visitor's own format. Tests pass a fixed locale and zone. */
const zone = (timeZone?: string) => (timeZone ? { timeZone } : {});

export function shortDate(ms: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...zone(timeZone),
  }).format(ms);
}

export function dateTime(ms: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...zone(timeZone),
  }).format(ms);
}

export function clockTime(ms: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...zone(timeZone),
  }).format(ms);
}

export function signedCredits(delta: number): string {
  return delta > 0
    ? `+${delta.toLocaleString("en-US")}`
    : `−${Math.abs(delta).toLocaleString("en-US")}`;
}

export function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
