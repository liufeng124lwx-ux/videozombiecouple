import { vi } from "vitest";
import { app } from "../src/router.ts";

export const TEAM = "vzc.cloudflareaccess.com";
export const AUD = "test-access-aud";
export const ADMIN = "boss@videozombiecouple.com";
export const API = "https://api.videozombiecouple.com";
export const ADMIN_ENV = {
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ADMIN_EMAILS: `${ADMIN}, ops@videozombiecouple.com`,
};

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** An RSA key standing in for Cloudflare Access, with its JWKS served to the Worker's fetch. */
export async function adminKit(env: Record<string, unknown>) {
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = {
    ...(await crypto.subtle.exportKey("jwk", keys.publicKey)),
    kid: `kid-${Math.random()}`,
  };
  vi.stubGlobal("fetch", async (url: string) =>
    String(url) === `https://${TEAM}/cdn-cgi/access/certs`
      ? Response.json({ keys: [jwk] })
      : new Response("not found", { status: 404 }),
  );
  const token = async (claims: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const head = encode({ alg: "RS256", kid: jwk.kid, typ: "JWT" });
    const body = encode({
      aud: [AUD],
      iss: `https://${TEAM}`,
      email: ADMIN,
      exp: now + 600,
      iat: now,
      ...claims,
    });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
  };
  const headers = async (t?: string) => ({ "cf-access-jwt-assertion": t ?? (await token()) });
  return {
    token,
    get: async (path: string, t?: string) => app.request(path, { headers: await headers(t) }, env),
    post: async (
      path: string,
      form: Record<string, string | string[]>,
      options: { token?: string; origin?: string | null } = {},
    ) => {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(form))
        for (const one of ([] as string[]).concat(v)) body.append(k, one);
      return app.request(
        path,
        {
          method: "POST",
          headers: {
            ...(await headers(options.token)),
            "content-type": "application/x-www-form-urlencoded",
            ...(options.origin === null ? {} : { origin: options.origin ?? API }),
          },
          body: body.toString(),
        },
        env,
      );
    },
  };
}
