/** `ms` plus `months` calendar months in UTC; the day is clamped to the month's last day. */
export function addMonths(ms: number, months: number): number {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

/**
 * The first monthly date after `after`, counted from `anchor` (spec 6.5: "the same day next month,
 * the 31st falls on the month's last day"). Counting from the anchor, not from the previous date,
 * keeps Jan 31 → Feb 28 → Mar 31 instead of drifting to the 28th.
 */
export function nextMonthly(anchor: number, after: number): number {
  for (let k = 1; k <= 1200; k++) {
    const at = addMonths(anchor, k);
    if (at > after) return at;
  }
  throw new Error("nextMonthly: no date within 100 years");
}

/** Waffo dates ("2026-05-01" or a full ISO time) as UTC milliseconds. */
export function parseDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
