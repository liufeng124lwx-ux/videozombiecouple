import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetFlags } from "../src/middleware/flags.ts";
import { jobBody, setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const NBP = "nano-banana-pro";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

async function member(credits: number, extra: Record<string, unknown> = {}) {
  const h = await setup(extra);
  await h.pass();
  const { userId, session } = await h.signIn();
  const wallet = h.wallets.instance(userId);
  if (credits > 0)
    await wallet.grant(userId, {
      kind: "pack",
      credits,
      expiresAt: null,
      sourceRef: null,
      reason: "test",
    });
  const create = async (overrides: Record<string, unknown> = {}) =>
    h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload(), overrides), session });
  const balance = async () => (await wallet.balance(userId)).total;
  const row = (id: string) =>
    h.db.prepare("SELECT input_key, priority, charge, expires_at FROM jobs WHERE id=?").get(id) as
      | { input_key: string; priority: string; charge: string; expires_at: number }
      | undefined;
  return { h, userId, session, create, balance, row };
}

describe("credit jobs (spec 5.2, 6.8)", () => {
  it("uses the 4 free photos first, then 1 credit per standard photo", async () => {
    const { h, session, create, balance, row } = await member(10);
    for (let i = 0; i < 4; i++) {
      const created = await create();
      expect(row(created.body.jobId as string)?.priority).toBe("free");
    }
    const paid = await create();
    expect(paid.status).toBe(201);
    const jobId = paid.body.jobId as string;
    expect(row(jobId)).toMatchObject({ priority: "paid", expires_at: NOON + 7 * 86_400_000 });
    // The runner rewrites the column with its own summary once it starts; the kind is what counts.
    expect(JSON.parse(row(jobId)?.charge ?? "{}").kind).toBe("credits");
    expect(row(jobId)?.input_key).toMatch(/^keep\//);
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith("in/"))).toHaveLength(4);
    expect(await balance()).toBe(9);
    expect((await h.call(`/v1/jobs/${jobId}`, { session })).body.charge).toEqual({
      kind: "credits",
      credits: 1,
    });
    await h.advance(60_000);
    expect(await balance()).toBe(9);
    expect(h.r2.objects.has(`keep/${jobId}/a1.png`)).toBe(true);
  });

  it("charges 3 credits for Pro once Nano Banana Pro delivers", async () => {
    const { h, create, balance } = await member(10);
    await create({ capability: "unblur.pro" });
    expect(await balance()).toBe(7);
    await h.advance(120_000);
    expect(await balance()).toBe(7);
  });

  it("charges 1 credit for Pro when only the Seedream candidate delivers", async () => {
    const { h, create, balance } = await member(10, {
      FAKE_SCRIPT: JSON.stringify({ [NBP]: [{ kind: "fail", failMsg: "internal error" }] }),
    });
    await create({ capability: "unblur.pro" });
    await h.advance(120_000);
    expect(await balance()).toBe(9);
  });

  it("gives the credits back when a paid job fails", async () => {
    const { h, create, balance } = await member(10, {
      FAKE_SCRIPT: JSON.stringify({
        [NBP]: [{ kind: "submit_error", code: 422, msg: "image could not be processed" }],
      }),
    });
    await create({ capability: "unblur.4k" });
    await h.advance(200_000);
    expect(await balance()).toBe(10);
  });

  // Review focus 5: not enough credits leaves nothing behind.
  it("refuses Pro without enough credits and leaves no job, hold or quota use", async () => {
    const { h, session, create, balance } = await member(2);
    const response = await create({ capability: "unblur.pro" });
    expect(response.status).toBe(402);
    expect(response.body.error?.code).toBe("CREDITS_LOW");
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    expect(await balance()).toBe(2);
    expect((await h.call("/v1/quota", { session })).body.remaining).toBe(4);
  });

  it("asks for credits once the free photos are used and there are none", async () => {
    const { create } = await member(0);
    for (let i = 0; i < 4; i++) await create();
    expect((await create()).body.error?.code).toBe("CREDITS_LOW");
  });

  it("charges credits straight away for a suspicious account", async () => {
    const { h, userId, create, balance, row } = await member(5);
    h.db.prepare("UPDATE users SET suspicious_at=? WHERE id=?").run(NOON, userId);
    const created = await create();
    expect(row(created.body.jobId as string)?.priority).toBe("paid");
    expect(await balance()).toBe(4);
  });

  // Final review: a paused free tier must not quietly turn free photos into paid ones.
  it("does not charge credits for free photos while the free tier is paused", async () => {
    const { h, create, balance } = await member(5);
    h.kv.store.set("flags", JSON.stringify({ freePaused: true }));
    expect((await create()).body.error?.code).toBe("FREE_TIER_PAUSED");
    expect(await balance()).toBe(5);
  });

  it("lets members whose free photos are used up keep paying while the free tier is paused", async () => {
    const { h, create, balance } = await member(5);
    for (let i = 0; i < 4; i++) await create();
    h.kv.store.set("flags", JSON.stringify({ freePaused: true }));
    vi.setSystemTime(Date.now() + 61_000); // flags are cached for a minute
    expect((await create()).status).toBe(201);
    expect(await balance()).toBe(4);
  });

  it("refuses credit jobs with PAUSED while paid jobs are paused, but free photos still work (review focus 4)", async () => {
    const { h, create } = await member(10);
    h.kv.store.set("flags", JSON.stringify({ paidPaused: true, paidPausedBy: "ops" }));
    forgetFlags(h.env.KV as unknown as KVNamespace);
    const free = await create();
    expect(free.status).toBe(201);
    const pro = await create({ capability: "unblur.pro" });
    expect(pro.body.error?.code).toBe("PAUSED");
  });

  it("stops free photos for a guest device with too many rejected photos", async () => {
    const h = await setup();
    await h.pass();
    const { hashIdentity } = await import("../src/services/crypto.ts");
    const owner = `g:${await hashIdentity("visitor:0123456789abcdef0123456789abcdef", "test-hmac-key")}`;
    for (let i = 0; i < 6; i++)
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,error_code,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `x${i}`,
          owner,
          "v",
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "p",
          `in/x${i}.jpg`,
          "{}",
          "{}",
          "failed",
          "{}",
          "free",
          `x-${i}`,
          "CONTENT_REJECTED",
          NOON - 1_000 + i,
          NOON + 86_400_000,
        );
    const response = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
    expect(response.body.error?.code).toBe("QUOTA_EXHAUSTED");
  });
});
