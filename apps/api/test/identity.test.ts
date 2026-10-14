import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetFlags } from "../src/middleware/flags.ts";
import { ipSegment } from "../src/middleware/identity.ts";
import { callbackToken, hashIdentity, safeEqual } from "../src/services/crypto.ts";
import { HMAC_KEY, IP, jobBody, setup, VISITOR } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("ipSegment", () => {
  it("groups IPv4 by /24 and IPv6 by /64", () => {
    expect(ipSegment("203.0.113.42")).toBe("203.0.113.0/24");
    expect(ipSegment("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(ipSegment("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipSegment("999.1.1.1")).toBe("unknown");
    expect(ipSegment("")).toBe("unknown");
  });
});

describe("crypto", () => {
  it("hashes identities to short url-safe strings and compares in constant time", async () => {
    const hash = await hashIdentity("visitor:x", HMAC_KEY);
    expect(hash).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(await hashIdentity("visitor:x", "other-key")).not.toBe(hash);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(await callbackToken("job1", HMAC_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("identity", () => {
  it("issues a visitor cookie to new browsers", async () => {
    const h = await setup();
    const response = await h.call("/v1/me", { headers: { cookie: "" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(
      /^vid=[a-f0-9]{32}; Max-Age=31536000; Domain=\.videozombiecouple\.com; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it("keeps a valid cookie and reports the guest owner", async () => {
    const h = await setup();
    const response = await h.call("/v1/me");
    expect(response.headers.get("set-cookie")).toBeNull();
    const visitorHash = await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY);
    expect(response.body).toEqual({
      user: null,
      owner: `g:${visitorHash}`,
      credits: null,
      banner: null,
      consentRequired: true,
      paid: false,
    });
  });
});

describe("ban", () => {
  it("blocks a banned IP segment until the ban expires", async () => {
    const h = await setup();
    const hash = await hashIdentity(`ip:${ipSegment(IP)}`, HMAC_KEY);
    h.db
      .prepare("INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)")
      .run(hash, "ip", Date.now() + 60_000, "test");
    expect((await h.call("/v1/me")).body.error?.code).toBe("FORBIDDEN");
    // The ban cache holds results for a minute.
    vi.setSystemTime(Date.now() + 61_000);
    expect((await h.call("/v1/me")).status).toBe(200);
  });

  it("blocks a banned device fingerprint", async () => {
    const h = await setup();
    const hash = await hashIdentity("device:device-123456", HMAC_KEY);
    h.db
      .prepare("INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)")
      .run(hash, "device", Date.now() + 60_000, "test");
    expect((await h.call("/v1/me", { headers: { "x-device": "device-123456" } })).status).toBe(403);
    expect((await h.call("/v1/me")).status).toBe(200);
  });
});

describe("flags", () => {
  it("pauses the API except account routes when the global switch is on", async () => {
    const h = await setup();
    h.kv.store.set("flags", JSON.stringify({ paused: true }));
    expect((await h.call("/v1/jobs", { method: "POST", body: {} })).body.error?.code).toBe(
      "PAUSED",
    );
    expect((await h.call("/v1/me")).status).toBe(200);
  });

  it("still serves job status while paused, but takes no new jobs or retries", async () => {
    const h = await setup();
    await h.pass();
    const created = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    expect(created.status).toBe(201);
    const jobId = created.body.jobId as string;
    const next = jobBody(await h.upload());
    h.kv.store.set("flags", JSON.stringify({ paused: true }));
    forgetFlags(h.kv.KV);
    expect((await h.call(`/v1/jobs/${jobId}`)).status).toBe(200);
    expect(
      (await h.call(`/v1/jobs/${jobId}/retry`, { method: "POST", body: {} })).body.error?.code,
    ).toBe("PAUSED");
    expect((await h.call("/v1/jobs", { method: "POST", body: next })).body.error?.code).toBe(
      "PAUSED",
    );
  });
});
