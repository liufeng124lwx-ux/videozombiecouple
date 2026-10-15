import { vi } from "vitest";

export const WHSEC = "whsec_test_0123456789abcdef";
export const PRICES: Record<string, string> = {
  pack1: "price_1KitPack1",
  pack3: "price_1KitPack3",
  pack5: "price_1KitPack5",
};

export const stripeEnv = (extra: Record<string, string> = {}) => ({
  STRIPE_SECRET_KEY: "sk_test_kit",
  STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_PRICES: JSON.stringify(PRICES),
  ...extra,
});

/** A Stripe-Signature header for `raw`, as Stripe computes it. */
export async function signStripe(raw: string, secret = WHSEC, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${raw}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

let seq = 0;
export function stripeEvent(type: string, object: Record<string, unknown>, livemode = false) {
  seq += 1;
  return {
    id: `evt_${String(seq).padStart(6, "0")}`,
    object: "event",
    type,
    livemode,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
}

type Call = { url: string; headers: Record<string, string>; form: URLSearchParams };

/** Stubs fetch for the Stripe API with one answer; returns the calls made. */
export function stripeApi(answer: unknown, status = 200) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        headers: init.headers as Record<string, string>,
        form: new URLSearchParams(String(init.body)),
      });
      return Response.json(answer, { status });
    }),
  );
  return calls;
}
