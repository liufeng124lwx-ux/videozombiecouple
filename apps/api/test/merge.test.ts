import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/durable-objects/rate-limiter.ts";
import { namespace, setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

async function signInByCode(h: Awaited<ReturnType<typeof setup>>, email = "ann@example.com") {
  await h.call("/v1/auth/email", { method: "POST", body: { email } });
  const code = /\b(\d{6})\b/.exec(h.mail[h.mail.length - 1]?.subject ?? "")?.[1];
  const response = await h.call("/v1/auth/code", { method: "POST", body: { email, code } });
  return /upx_sess=([a-f0-9]{64})/.exec(response.headers.getSetCookie().join(";"))?.[1];
}

describe("RateLimiter.absorb", () => {
  it("tops today's count up to the given number without double counting", async () => {
    const limiter = namespace((ctx) => new RateLimiter(ctx, {} as never)).instance("quota:user:u");
    await limiter.absorb("merge:v", 2);
    await limiter.absorb("merge:v", 2);
    expect(await limiter.used()).toBe(2);
    await limiter.absorb("merge:v", 3);
    expect(await limiter.used()).toBe(3);
  });
});

describe("guest to account merge (spec 5.1)", () => {
  // Previews need an account, so a guest has nothing to bring; signing in again hands out nothing.
  it("gives the account its own previews however often the browser signs in", async () => {
    const h = await setup();
    await h.pass();
    expect((await h.call("/v1/quota")).body).toMatchObject({ loginRequired: true });
    const first = await signInByCode(h);
    expect((await h.call("/v1/quota", { session: first })).body).toMatchObject({
      remaining: 3,
      limit: 3,
    });
    await h.call("/v1/auth/logout", { method: "POST", session: first });
    const second = await signInByCode(h);
    expect((await h.call("/v1/quota", { session: second })).body).toMatchObject({ remaining: 3 });
  });
});
