import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/durable-objects/rate-limiter.ts";
import { namespace, setup, storyBody } from "./harness.ts";

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
  // Owner, 2026-10-15: a guest can start a story; signing in brings it along so it can be paid for.
  it("moves the stories this browser started as a guest to the account", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    await h.pass();
    const a = await h.upload();
    const b = await h.upload();
    const id = (await h.call("/v1/stories", { method: "POST", body: storyBody(a, b) })).body
      .storyId as string;
    await h.untilStory(id, "preview_ready");
    const session = await signInByCode(h);
    expect((await h.call(`/v1/stories/${id}`, { session })).status).toBe(200);
    const row = h.db.prepare("SELECT owner, user_id FROM stories WHERE id=?").get(id) as {
      owner: string;
      user_id: string;
    };
    expect(row.owner).toBe(`u:${row.user_id}`);
    expect(row.user_id).not.toBe("");
  });
});
