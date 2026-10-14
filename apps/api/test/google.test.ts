import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/router.ts";
import { setup, VISITOR } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const CLIENT = "client-id.apps.googleusercontent.com";
const encode = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idToken = (claims: Record<string, unknown>) =>
  `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;

function google(claims: Record<string, unknown>) {
  const token = vi.fn(async () =>
    Response.json({
      id_token: idToken({
        iss: "https://accounts.google.com",
        aud: CLIENT,
        sub: "google-sub-1",
        email: "Ann@Gmail.com",
        email_verified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...claims,
      }),
    }),
  );
  vi.stubGlobal("fetch", token);
  return token;
}

async function flow(h: Awaited<ReturnType<typeof setup>>, next = "/unblur-photo") {
  const start = await app.request(
    `/auth/google/start?next=${encodeURIComponent(next)}`,
    { headers: { cookie: `vid=${VISITOR}` } },
    h.env as never,
  );
  const location = new URL(start.headers.get("location") ?? "");
  const state = location.searchParams.get("state") ?? "";
  const callback = await app.request(
    `/auth/google/callback?state=${state}&code=auth-code`,
    { headers: { cookie: `vid=${VISITOR}; upx_gstate=${state}` } },
    h.env as never,
  );
  return { start, location, callback };
}

describe("Google sign-in (spec 5.1)", () => {
  const env = { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "secret" };

  it("sends the browser to Google with PKCE and a state", async () => {
    const h = await setup(env);
    google({}); // flow() also runs the callback; never reach the real token endpoint
    const { start, location } = await flow(h);
    expect(start.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe(CLIENT);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost/auth/google/callback");
  });

  it("creates the account, signs in and returns to the page", async () => {
    const h = await setup(env);
    google({});
    const { callback } = await flow(h);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe("https://videozombiecouple.com/unblur-photo");
    expect(callback.headers.getSetCookie().join(";")).toMatch(/upx_sess=[a-f0-9]{64}/);
    expect(h.db.prepare("SELECT email, google_sub FROM users").get()).toEqual({
      email: "ann@gmail.com",
      google_sub: "google-sub-1",
    });
  });

  it("links Google to an existing account with the same email", async () => {
    const h = await setup(env);
    const { userId } = await h.signIn("ann@gmail.com");
    google({});
    await flow(h);
    expect(h.db.prepare("SELECT id, google_sub FROM users").all()).toEqual([
      { id: userId, google_sub: "google-sub-1" },
    ]);
  });

  it("refuses unverified Google emails, tokens for other apps and a wrong state", async () => {
    const h = await setup(env);
    google({ email_verified: false });
    expect((await flow(h)).callback.headers.get("location")).toBe(
      "https://videozombiecouple.com/account?error=google",
    );
    google({ aud: "someone-else" });
    expect((await flow(h)).callback.headers.get("location")).toContain("error=google");
    const forged = await app.request(
      "/auth/google/callback?state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code=x",
      { headers: { cookie: "upx_gstate=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
      h.env as never,
    );
    expect(forged.headers.get("location")).toContain("error=google");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 0 });
  });

  it("is off when the Google client is not configured", async () => {
    const h = await setup();
    const start = await app.request("/auth/google/start", {}, h.env as never);
    expect(start.headers.get("location")).toBe(
      "https://videozombiecouple.com/account?error=google",
    );
  });
});
