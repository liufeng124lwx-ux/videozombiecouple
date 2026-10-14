import { productByKey } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/**
 * Waffo Pancake on WebCrypto (the official SDK needs node:crypto). Request signing, webhook
 * verification and endpoint shapes follow @waffo/pancake-ts 0.25.0; signing and verification are
 * copied from Vidova.
 */

const API_BASE = "https://api.waffo.ai";
const WEBHOOK_PAST_TOLERANCE_MS = 45 * 60 * 1000;
const WEBHOOK_FUTURE_TOLERANCE_MS = 60 * 1000;
const PRODUCT_ID = /^PROD_[0-9A-Za-z]{22}$/;

// Platform webhook keys shared by every merchant (from the SDK).
const WEBHOOK_KEYS = {
  test: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxnmRY6yMMA3lVqmAU6ZG
b1sjL/+r/z6E+ZjkXaDAKiqOhk9rpazni0bNsGXwmftTPk9jy2wn+j6JHODD/WH/
SCnSfvKkLIjy4Hk7BuCgB174C0ydan7J+KgXLkOwgCAxxB68t2tezldwo74ZpXgn
F49opzMvQ9prEwIAWOE+kV9iK6gx/AckSMtHIHpUesoPDkldpmFHlB2qpf1vsFTZ
5kD6DmGl+2GIVK01aChy2lk8pLv0yUMu18v44sLkO5M44TkGPJD9qG09wrvVG2wp
OTVCn1n5pP8P+HRLcgzbUB3OlZVfdFurn6EZwtyL4ZD9kdkQ4EZE/9inKcp3c1h4
xwIDAQAB
-----END PUBLIC KEY-----`,
  prod: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz+xApdTIb4ua+DgZKQ54
iBsD82ybyhGCLRETONW4Jgbb3A8DUM1LqBk6r/CmTOCHqLalTQHNigvP3R5zkDNX
iRJz6gA4MJ/+8K0+mnEE2RISQzN+Qu65TNd6svb+INm/kMaftY4uIXr6y6kchtTJ
dwnQhcKdAL2v7h7IFnkVelQsKxDdb2PqX8xX/qwd01iXvMcpCCaXovUwZsxH2QN5
ZKBTseJivbhUeyJCco4fdUyxOMHe2ybCVhyvim2uxAl1nkvL5L8RCWMCAV55LLo0
9OhmLahz/DYNu13YLVP6dvIT09ZFBYU6Owj1NxdinTynlJCFS9VYwBgmftosSE1U
dwIDAQAB
-----END PUBLIC KEY-----`,
};

export type WaffoMode = "test" | "prod";

export interface WaffoWebhookEvent {
  id: string;
  timestamp: string;
  eventType: string;
  eventId: string;
  storeId: string;
  mode: WaffoMode;
  data: Record<string, unknown>;
}

export type WaffoConfig = {
  mode: WaffoMode;
  merchantId: string;
  privateKey: string;
  /** Short id first when set; webhooks may carry the short id or the UUID. */
  storeIds: string[];
  /** productKey → Waffo product id. */
  products: Record<string, string>;
};

export class WaffoError extends Error {}

export function waffoConfig(env: Bindings): WaffoConfig | null {
  const mode = env.WAFFO_MODE === "test" || env.WAFFO_MODE === "prod" ? env.WAFFO_MODE : null;
  const storeIds = (env.WAFFO_STORE_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!mode || !env.WAFFO_MERCHANT_ID || !env.WAFFO_PRIVATE_KEY || storeIds.length === 0)
    return null;
  let products: Record<string, string> = {};
  try {
    const parsed = JSON.parse(env.WAFFO_PRODUCTS ?? "{}") as Record<string, unknown>;
    products = Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          productByKey(entry[0]) !== null &&
          typeof entry[1] === "string" &&
          PRODUCT_ID.test(entry[1]),
      ),
    );
  } catch {
    products = {};
  }
  return {
    mode,
    merchantId: env.WAFFO_MERCHANT_ID,
    privateKey: env.WAFFO_PRIVATE_KEY,
    storeIds,
    products,
  };
}

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** X-Signature: RSA-SHA256 over "METHOD\npath\ntimestamp\nbase64(sha256(body))". */
export async function signRequest(
  method: string,
  path: string,
  timestamp: string,
  body: string,
  privateKeyPem: string,
): Promise<string> {
  const bodyHash = toBase64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(privateKeyPem), RSA, false, ["sign"]);
  const canonical = `${method}\n${path}\n${timestamp}\n${bodyHash}`;
  return toBase64(await crypto.subtle.sign(RSA, key, new TextEncoder().encode(canonical)));
}

async function send(
  path: string,
  body: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new WaffoError(`${path}: ${String(error)}`);
  }
  let envelope: { data?: Record<string, unknown>; errors?: unknown[] };
  try {
    envelope = (await response.json()) as typeof envelope;
  } catch {
    throw new WaffoError(`${path}: non-JSON response ${response.status}`);
  }
  if (!response.ok || envelope.errors?.length || !envelope.data)
    throw new WaffoError(`${path}: ${response.status} ${JSON.stringify(envelope.errors ?? [])}`);
  return envelope.data;
}

async function merchantPost(config: WaffoConfig, path: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return send(path, body, {
    "x-merchant-id": config.merchantId,
    "x-timestamp": timestamp,
    "x-signature": await signRequest("POST", path, timestamp, body, config.privateKey),
  });
}

async function customerPost(
  config: WaffoConfig,
  token: string,
  path: string,
  payload: Record<string, unknown>,
) {
  return send(path, JSON.stringify(payload), {
    authorization: `Bearer ${token}`,
    "x-environment": config.mode,
  });
}

function productId(config: WaffoConfig, productKey: string): string {
  const id = config.products[productKey];
  if (!id) throw new WaffoError(`no Waffo product for ${productKey}`);
  return id;
}

/** A customer session token; Waffo binds orders to `buyerIdentity`, our user id. */
async function sessionToken(
  config: WaffoConfig,
  scope: { productId: string } | { storeId: string },
  userId: string,
): Promise<string> {
  const data = await merchantPost(config, "/v1/actions/auth/issue-session-token", {
    ...scope,
    buyerIdentity: userId,
  });
  if (typeof data.token !== "string") throw new WaffoError("issue-session-token: no token");
  return data.token;
}

function checkoutUrl(data: Record<string, unknown>, token: string): string {
  const url = data.checkoutUrl;
  if (typeof url !== "string" || !url.startsWith("https://"))
    throw new WaffoError(`create-session: bad checkout URL ${String(url)}`);
  return `${url}#token=${token}`;
}

/** Authenticated checkout: the order stays ours even if the buyer types another email. */
export async function createCheckout(
  config: WaffoConfig,
  params: {
    productKey: string;
    userId: string;
    email: string;
    successUrl: string;
    metadata: Record<string, string>;
    externalId: string;
  },
): Promise<string> {
  const id = productId(config, params.productKey);
  const [token, session] = await Promise.all([
    sessionToken(config, { productId: id }, params.userId),
    merchantPost(config, "/v1/actions/checkout/create-session", {
      productId: id,
      currency: "USD",
      buyerEmail: params.email,
      successUrl: params.successUrl,
      metadata: params.metadata,
      orderMerchantExternalId: params.externalId,
      expiresInSeconds: 3600,
    }),
  ]);
  return checkoutUrl(session, token);
}

/** Spec 6.5: upgrades take effect now (Waffo prorates); downgrades at the next period. */
export async function createPlanChange(
  config: WaffoConfig,
  params: {
    originOrderId: string;
    productKey: string;
    userId: string;
    timing: "immediate" | "next_period";
  },
): Promise<string> {
  const id = productId(config, params.productKey);
  const [token, session] = await Promise.all([
    sessionToken(config, { productId: id }, params.userId),
    merchantPost(config, "/v1/actions/checkout/create-session", {
      originOrderId: params.originOrderId,
      productId: id,
      currency: "USD",
      changeTiming: params.timing,
    }),
  ]);
  return checkoutUrl(session, token);
}

async function customerAction(
  config: WaffoConfig,
  path: string,
  params: { orderId: string; userId: string },
): Promise<string> {
  const storeId = config.storeIds.find((id) => id.startsWith("STO_")) ?? config.storeIds[0] ?? "";
  const token = await sessionToken(config, { storeId }, params.userId);
  const data = await customerPost(config, token, path, { orderId: params.orderId });
  if (typeof data.status !== "string") throw new WaffoError(`${path}: no status`);
  return data.status;
}

/** Returns "canceling" (active subscriptions stop at the period end) or "canceled". */
export function cancelSubscription(
  config: WaffoConfig,
  params: { orderId: string; userId: string },
) {
  return customerAction(config, "/v1/actions/subscription-order/cancel-order", params);
}

export function reactivateSubscription(
  config: WaffoConfig,
  params: { orderId: string; userId: string },
) {
  return customerAction(config, "/v1/actions/subscription-order/reactivate-order", params);
}

/**
 * Verifies X-Waffo-Signature ("t=<ms>,v1=<base64>") over "${t}.${rawBody}".
 * Returns null when the signature, timestamp, mode or body is not valid.
 */
export async function verifyWebhook(
  rawBody: string,
  header: string | undefined,
  mode: WaffoMode,
  now = Date.now(),
  publicKeyPem: string | undefined = WEBHOOK_KEYS[mode],
): Promise<WaffoWebhookEvent | null> {
  const keyPem = publicKeyPem ?? WEBHOOK_KEYS[mode];
  if (!header) return null;
  let t = "";
  let v1 = "";
  for (const pair of header.split(",")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (name === "t") t = value;
    else if (name === "v1") v1 = value;
  }
  const sentAt = Number(t);
  if (!t || !v1 || !Number.isFinite(sentAt)) return null;
  const age = now - sentAt;
  if (age > WEBHOOK_PAST_TOLERANCE_MS || age < -WEBHOOK_FUTURE_TOLERANCE_MS) return null;
  let signature: Uint8Array<ArrayBuffer>;
  try {
    signature = Uint8Array.from(atob(v1), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey("spki", pemBytes(keyPem), RSA, false, ["verify"]);
  const valid = await crypto.subtle.verify(
    RSA,
    key,
    signature,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
  if (!valid) return null;
  try {
    const event = JSON.parse(rawBody) as WaffoWebhookEvent;
    if (
      typeof event.id !== "string" ||
      typeof event.eventType !== "string" ||
      event.mode !== mode ||
      typeof event.data !== "object" ||
      event.data === null
    )
      return null;
    return event;
  } catch {
    return null;
  }
}
