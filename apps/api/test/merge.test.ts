import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/durable-objects/rate-limiter.ts";
import { jobBody, namespace, setup } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

const OTHER = "ffffffffffffffffffffffffffffffff";

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
  it("counts the guest's free photos today against the account", async () => {
    const h = await setup();
    await h.pass();
    for (let i = 0; i < 2; i++)
      await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    const session = await signInByCode(h);
    expect((await h.call("/v1/quota", { session })).body).toMatchObject({ remaining: 2, limit: 4 });
  });

  // Review focus 3: signing in again must not hand out more free photos.
  it("merges only once however often the browser signs in", async () => {
    const h = await setup();
    await h.pass();
    await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    const first = await signInByCode(h);
    await h.call("/v1/auth/logout", { method: "POST", session: first });
    const second = await signInByCode(h);
    expect((await h.call("/v1/quota", { session: second })).body).toMatchObject({ remaining: 3 });
  });

  it("hands unfinished guest jobs to the account and keeps finished ones visible here", async () => {
    const h = await setup();
    await h.pass();
    const done = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    await h.advance(60_000);
    const running = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    const session = await signInByCode(h);
    const owner = (id: string) =>
      (h.db.prepare("SELECT owner FROM jobs WHERE id=?").get(id) as { owner: string }).owner;
    expect(owner(running.body.jobId as string)).toMatch(/^u:/);
    expect(owner(done.body.jobId as string)).toMatch(/^g:/);
    expect((await h.call(`/v1/jobs/${done.body.jobId}`, { session })).status).toBe(200);
    expect((await h.call(`/v1/jobs/${running.body.jobId}`, { session })).status).toBe(200);
    expect((await h.call(`/v1/jobs/${done.body.jobId}`, { visitor: OTHER })).status).toBe(404);
  });
});
