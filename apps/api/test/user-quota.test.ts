import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewCounters, reserveQuota } from "../src/services/quota.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("signed-in daily preview quota (spec 7)", () => {
  it("gives a signed-in user 3 free previews a day", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    expect((await h.call("/v1/quota", { session })).body).toMatchObject({
      remaining: 3,
      limit: 3,
      resetAt: Date.UTC(2026, 9, 10),
    });
    const env = h.env as unknown as Bindings;
    const counters = previewCounters(userId, "ip-a");
    for (let i = 0; i < 3; i++) expect(await reserveQuota(env, counters, `s${i}`)).toBe(true);
    expect(await reserveQuota(env, counters, "s3")).toBe(false);
  });

  it("still counts the IP segment's 10 a day across accounts", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    for (let i = 0; i < 10; i++)
      expect(await reserveQuota(env, previewCounters(`user${i}`, "ip-a"), `s${i}`)).toBe(true);
    expect(await reserveQuota(env, previewCounters("user10", "ip-a"), "s10")).toBe(false);
  });

  it("shows no free quota to a suspicious account", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    h.db.prepare("UPDATE users SET suspicious_at=? WHERE id=?").run(NOON, userId);
    expect((await h.call("/v1/quota", { session })).body).toMatchObject({ remaining: 0 });
  });
});
