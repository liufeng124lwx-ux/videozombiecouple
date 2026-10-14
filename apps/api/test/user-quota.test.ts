import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryAllowed } from "../src/services/free-retry.ts";
import { reserveQuota, userCounters } from "../src/services/quota.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

describe("signed-in daily quota (spec 5.2)", () => {
  it("gives a signed-in user 4 free photos a day", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    expect((await h.call("/v1/quota", { session })).body).toMatchObject({ remaining: 4, limit: 4 });
    const env = h.env as unknown as Bindings;
    const counters = userCounters(userId, "ip-a");
    for (let i = 0; i < 4; i++) expect(await reserveQuota(env, counters, `j${i}`)).toBe(true);
    expect(await reserveQuota(env, counters, "j4")).toBe(false);
  });

  it("still counts the IP segment's 10 a day across accounts", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    for (let i = 0; i < 10; i++)
      expect(await reserveQuota(env, userCounters(`user${i}`, "ip-a"), `j${i}`)).toBe(true);
    expect(await reserveQuota(env, userCounters("user10", "ip-a"), "j10")).toBe(false);
  });

  it("shows no free quota to a suspicious account", async () => {
    const h = await setup();
    const { userId, session } = await h.signIn();
    h.db.prepare("UPDATE users SET suspicious_at=? WHERE id=?").run(NOON, userId);
    expect((await h.call("/v1/quota", { session })).body).toMatchObject({ remaining: 0 });
  });
});

describe("free retries per account (spec 3.7)", () => {
  it("allows 3 a day per account, across browsers", async () => {
    const h = await setup();
    for (let i = 0; i < 3; i++)
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,free_retry,retried_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `r${i}`,
          "u:u1",
          `browser${i}`,
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "p",
          `in/${i}.jpg`,
          "{}",
          "{}",
          "succeeded",
          "{}",
          "free",
          `k${i}`,
          1,
          NOON - 100 + i,
          NOON - 1_000 + i,
          NOON + 86_400_000,
        );
    const db = h.env.DB as D1Database;
    const who = { owner: "u:u1", userId: "u1", visitorHash: "browser9", fpHash: null };
    expect(await retryAllowed(db, who)).toBe(false);
    expect(await retryAllowed(db, { ...who, owner: "u:u2", userId: "u2" })).toBe(true);
  });
});
