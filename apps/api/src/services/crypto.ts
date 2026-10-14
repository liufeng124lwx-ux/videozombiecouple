const encoder = new TextEncoder();

async function hmac(value: string, key: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(value)));
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Short keyed hash for identities (visitor, device, IP segment); never stores the raw value. */
export async function hashIdentity(value: string, key: string): Promise<string> {
  return toBase64Url((await hmac(value, key)).slice(0, 8));
}

export async function hmacHex(value: string, key: string): Promise<string> {
  return Array.from(await hmac(value, key), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The `t` query parameter on kie callback URLs (spec 4.1). */
export function callbackToken(jobId: string, key: string): Promise<string> {
  return hmacHex(`kie-callback:${jobId}`, key);
}
