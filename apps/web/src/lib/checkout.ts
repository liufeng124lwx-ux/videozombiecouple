const KEY = "upx-checkout";

/** Spec 6.4: remember the balance before checkout, to see when the payment's credits arrive. */
export function rememberCheckout(credits: number, now = Date.now()): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ credits, at: now }));
  } catch {}
}

export function pendingCheckout(): { credits: number; at: number } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as {
      credits?: unknown;
      at?: unknown;
    } | null;
    return value && typeof value.credits === "number" && typeof value.at === "number"
      ? { credits: value.credits, at: value.at }
      : null;
  } catch {
    return null;
  }
}

export function clearCheckout(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
