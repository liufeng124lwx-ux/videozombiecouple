import { productByKey } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/**
 * Stripe, with Managed Payments (Stripe is the merchant of record: sales tax, VAT, fraud and
 * disputes). A minimal client on fetch + WebCrypto: one Checkout Session call and webhook
 * verification. No Stripe-Version header: the account's default version applies, and the session,
 * charge and dispute fields used here are stable across versions.
 */

const API = "https://api.stripe.com/v1";
const TOLERANCE_SECONDS = 300;
const PRICE_ID = /^price_[0-9A-Za-z]{6,64}$/;

export class StripeError extends Error {}

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
  /** A live key only accepts live events, a test key only test events. */
  live: boolean;
  /** productKey → Stripe price id (scripts/stripe-setup.ts). */
  prices: Record<string, string>;
};

/** Null unless the key is set; prices only for products the catalog sells. */
export function stripeConfig(env: Bindings): StripeConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) return null;
  let prices: Record<string, string> = {};
  try {
    const parsed = JSON.parse(env.STRIPE_PRICES ?? "{}") as Record<string, unknown>;
    prices = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          productByKey(entry[0]) !== null &&
          typeof entry[1] === "string" &&
          PRICE_ID.test(entry[1]),
      ),
    );
  } catch {
    prices = {};
  }
  return {
    secretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    live: /^(sk|rk)_live_/.test(secretKey),
    prices,
  };
}

export type StripeCheckout = {
  productKey: string;
  userId: string;
  email: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
};

/** The Checkout Session form: one pack, Managed Payments on, metadata on the session and payment. */
export function checkoutForm(config: StripeConfig, params: StripeCheckout): URLSearchParams {
  const price = config.prices[params.productKey];
  if (!price) throw new StripeError(`no Stripe price for ${params.productKey}`);
  const form = new URLSearchParams({
    mode: "payment",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "managed_payments[enabled]": "true",
    customer_email: params.email,
    client_reference_id: params.userId,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
  for (const [key, value] of Object.entries(params.metadata)) {
    form.set(`metadata[${key}]`, value);
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }
  return form;
}

export async function createStripeCheckout(
  config: StripeConfig,
  params: StripeCheckout,
): Promise<string> {
  const form = checkoutForm(config, params);
  let response: Response;
  try {
    response = await fetch(`${API}/checkout/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": params.idempotencyKey,
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new StripeError(`stripe checkout: ${error instanceof Error ? error.message : error}`);
  }
  const data = (await response.json().catch(() => ({}))) as {
    url?: unknown;
    error?: { message?: unknown };
  };
  if (!response.ok || typeof data.url !== "string" || !data.url.startsWith("https://"))
    throw new StripeError(
      `stripe checkout: ${response.status} ${String(data.error?.message ?? "")}`,
    );
  return data.url;
}

export interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  created?: number;
  data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> };
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies Stripe-Signature ("t=<seconds>,v1=<hex>[,v1=…]"): HMAC-SHA256 of "${t}.${raw}" with the
 * endpoint secret, within five minutes. Null for a bad, stale or missing signature or a bad body.
 */
export async function verifyStripeWebhook(
  raw: string,
  header: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<StripeEvent | null> {
  if (!header || !secret) return null;
  let t = "";
  const signatures: string[] = [];
  for (const pair of header.split(",")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name === "t") t = value;
    else if (name === "v1") signatures.push(value);
  }
  const sentAt = Number(t);
  if (!t || !Number.isFinite(sentAt) || signatures.length === 0) return null;
  if (Math.abs(now / 1000 - sentAt) > TOLERANCE_SECONDS) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`)),
  );
  if (!signatures.some((signature) => sameHex(signature, expected))) return null;
  try {
    const event = JSON.parse(raw) as StripeEvent;
    if (
      typeof event.id !== "string" ||
      typeof event.type !== "string" ||
      typeof event.livemode !== "boolean" ||
      !event.data ||
      typeof event.data.object !== "object" ||
      event.data.object === null
    )
      return null;
    return event;
  } catch {
    return null;
  }
}
