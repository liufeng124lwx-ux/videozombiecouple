import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSuspicious, noteRejections } from "../src/services/suspicion.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

/** Signs up `email` through the email code, from a device and IP of our choosing. */
async function signUp(
  h: Awaited<ReturnType<typeof setup>>,
  email: string,
  from: { device?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = from.device ? { "x-device": from.device } : {};
  await h.pass(undefined, from.ip);
  await h.call("/v1/auth/email", { method: "POST", body: { email }, headers, ip: from.ip });
  const code = /\b(\d{6})\b/.exec(h.mail[h.mail.length - 1]?.subject ?? "")?.[1];
  await h.call("/v1/auth/code", { method: "POST", body: { email, code }, headers, ip: from.ip });
  const user = h.db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: string };
  return (await h.wallets.instance(user.id).balance(user.id)).total;
}

describe("sign-up bonus (spec 5.4)", () => {
  it("gives a new account 5 credits once", async () => {
    const h = await setup();
    expect(await signUp(h, "ann@example.com", { device: "device-aaaaaaaa" })).toBe(5);
    expect(await signUp(h, "ann@example.com", { device: "device-aaaaaaaa" })).toBe(5);
  });

  it("gives one bonus per device every 30 days", async () => {
    const h = await setup();
    await signUp(h, "a@example.com", { device: "device-aaaaaaaa", ip: "198.51.100.1" });
    expect(await signUp(h, "b@example.com", { device: "device-aaaaaaaa", ip: "203.0.113.9" })).toBe(
      0,
    );
    vi.setSystemTime(NOON + 31 * 86_400_000);
    expect(await signUp(h, "c@example.com", { device: "device-aaaaaaaa", ip: "203.0.113.9" })).toBe(
      5,
    );
  });

  it("gives one bonus per IP segment every 30 days", async () => {
    const h = await setup();
    await signUp(h, "a@example.com", { device: "device-aaaaaaaa", ip: "198.51.100.1" });
    expect(
      await signUp(h, "b@example.com", { device: "device-bbbbbbbb", ip: "198.51.100.77" }),
    ).toBe(0);
  });

  it("gives nothing to a device marked suspicious", async () => {
    const h = await setup();
    const { hashIdentity } = await import("../src/services/crypto.ts");
    const fp = await hashIdentity("device:device-aaaaaaaa", "test-hmac-key");
    h.kv.store.set(`suspicious:fp:${fp}`, JSON.stringify({ until: NOON + 86_400_000 }));
    expect(await signUp(h, "a@example.com", { device: "device-aaaaaaaa" })).toBe(0);
  });
});

describe("suspicious marks (spec 7.3)", () => {
  function rejected(h: Awaited<ReturnType<typeof setup>>, n: number, owner: string, fp: string) {
    for (let i = 0; i < n; i++)
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,fp_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,error_code,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `rej${owner}${i}`,
          owner,
          "v",
          fp,
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "p",
          `in/${i}.jpg`,
          "{}",
          "{}",
          "failed",
          "{}",
          "free",
          `rej-${owner}-${i}`,
          "CONTENT_REJECTED",
          NOON - 3_600_000 + i,
          NOON + 86_400_000,
        );
  }

  it("marks an account and its device after more than 5 rejections in 24 hours", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    const { userId } = await h.signIn();
    const who = { owner: `u:${userId}`, userId, fpHash: "fp1" };
    rejected(h, 5, who.owner, "fp1");
    expect(await noteRejections(env, who)).toBe(false);
    expect(await isSuspicious(env, who)).toBe(false);
    rejected(h, 1, `${who.owner}x`, "fp1");
    h.db.prepare("UPDATE jobs SET owner=? WHERE owner=?").run(who.owner, `${who.owner}x`);
    expect(await noteRejections(env, who)).toBe(true);
    expect(await isSuspicious(env, who)).toBe(true);
    expect(await isSuspicious(env, { owner: "g:other", userId: null, fpHash: "fp1" })).toBe(true);
  });

  it("marks a guest by owner when there is no device fingerprint", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    rejected(h, 6, "g:guest", "fpx");
    const who = { owner: "g:guest", userId: null, fpHash: null };
    expect(await noteRejections(env, who)).toBe(true);
    expect(await isSuspicious(env, who)).toBe(true);
  });

  it("forgets rejections older than 24 hours", async () => {
    const h = await setup();
    const env = h.env as unknown as Bindings;
    rejected(h, 6, "g:guest", "fpx");
    vi.setSystemTime(NOON + 86_400_000);
    expect(await noteRejections(env, { owner: "g:guest", userId: null, fpHash: null })).toBe(false);
  });
});

// Final review: the 30-day check was a KV read followed by a KV write, so sign-ups that landed
// together all passed it.
describe("sign-up bonus under concurrency", () => {
  it("gives one bonus when several accounts from one IP segment sign up at once", async () => {
    const h = await setup();
    await h.pass();
    const emails = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    const codes: string[] = [];
    for (const email of emails) {
      await h.call("/v1/auth/email", { method: "POST", body: { email } });
      codes.push(/\b(\d{6})\b/.exec(h.mail[h.mail.length - 1]?.subject ?? "")?.[1] ?? "");
    }
    // Slow KV reads of the bonus keys: every sign-up reads "not granted yet" before any writes.
    const kv = h.env.KV as KVNamespace;
    const get = kv.get.bind(kv) as (key: string) => Promise<string | null>;
    (kv as unknown as { get: (key: string) => Promise<string | null> }).get = async (key) => {
      const value = await get(key);
      if (key.startsWith("bonus:")) await new Promise((resolve) => setTimeout(resolve, 20));
      return value;
    };
    await Promise.all(
      emails.map((email, i) =>
        h.call("/v1/auth/code", { method: "POST", body: { email, code: codes[i] } }),
      ),
    );
    const granted = h.db
      .prepare("SELECT COUNT(*) AS n FROM credit_buckets WHERE source_ref='signup'")
      .get();
    expect(granted).toEqual({ n: 1 });
  });
});
