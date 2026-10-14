import type { Bindings } from "../types.ts";

/**
 * Spec 9: revenue comes from the server. The browser's GA4 client_id travels through the checkout
 * metadata so the purchase joins its session. Failures are logged, never thrown.
 */
export async function reportPurchase(
  env: Bindings,
  purchase: {
    clientId: string | null;
    transactionId: string;
    value: number | null;
    currency: string | null;
    item: string;
  },
): Promise<void> {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET || !purchase.clientId) return;
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
  try {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify({
        client_id: purchase.clientId,
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: purchase.transactionId,
              value: purchase.value,
              currency: purchase.currency,
              items: [{ item_id: purchase.item }],
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", ga4: String(error) }));
  }
}
