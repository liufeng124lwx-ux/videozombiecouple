import { PRODUCTS } from "@vzc/catalog";
import { vi } from "vitest";
import type { WaffoWebhookEvent } from "../src/billing/waffo.ts";

export const STORE_ID = `STO_${"s".repeat(22)}`;
export const STORE_UUID = "11111111-1111-1111-1111-111111111111";
export const MERCHANT_ID = `MER_${"m".repeat(22)}`;

/** A Waffo-shaped product id per product key (PROD_ + 22 alphanumerics). */
export const PRODUCT_IDS: Record<string, string> = Object.fromEntries(
  PRODUCTS.map((p) => [p.key, `PROD_${p.key.replace(/_/g, "").padEnd(22, "x").slice(0, 22)}`]),
);

const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const pem = (label: string, bytes: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${toBase64(bytes).replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----`;

let cached:
  | Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; privatePem: string; publicPem: string }>
  | undefined;

/** One RSA key pair per test run, standing in for both the merchant key and Waffo's webhook key. */
function keys() {
  cached ??= (async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    return {
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
      privatePem: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
      publicPem: pem("PUBLIC KEY", await crypto.subtle.exportKey("spki", pair.publicKey)),
    };
  })();
  return cached;
}

export async function waffoKit() {
  const k = await keys();
  return {
    keys: k,
    env: {
      WAFFO_MODE: "test",
      WAFFO_MERCHANT_ID: MERCHANT_ID,
      WAFFO_PRIVATE_KEY: k.privatePem,
      WAFFO_STORE_ID: `${STORE_ID},${STORE_UUID}`,
      WAFFO_PRODUCTS: JSON.stringify(PRODUCT_IDS),
      WAFFO_WEBHOOK_PUBLIC_KEY: k.publicPem,
    },
  };
}

export const TOKEN = "/v1/actions/auth/issue-session-token";
export const SESSION = "/v1/actions/checkout/create-session";

type Call = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  raw: string;
};

/**
 * Stubs fetch for the Waffo API: answers each call by path (checkout fires two calls at once, so
 * their order is not fixed) and returns a lookup of what was sent. Undo with vi.unstubAllGlobals.
 */
export function waffoApi(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const raw = String(init.body);
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(raw),
        raw,
      });
      return Response.json(routes[new URL(url).pathname]);
    }),
  );
  return (path: string) => calls.find((call) => call.url.endsWith(path));
}

export async function signWebhook(body: string, privateKey: CryptoKey, t = Date.now()) {
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    new TextEncoder().encode(`${t}.${body}`),
  );
  return `t=${t},v1=${toBase64(signature)}`;
}

export function waffoEvent(
  eventType: string,
  data: Record<string, unknown>,
  overrides: Partial<WaffoWebhookEvent> = {},
): WaffoWebhookEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    eventType,
    eventId: `PAY_${"p".repeat(22)}`,
    storeId: STORE_ID,
    mode: "test",
    data: {
      orderId: `ORD_${"o".repeat(22)}`,
      buyerEmail: "ann@example.com",
      currency: "USD",
      amount: "0",
      taxAmount: "0",
      productName: "VideoZombieCouple",
      ...data,
    },
    ...overrides,
  };
}
