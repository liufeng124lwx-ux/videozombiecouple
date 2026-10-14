import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callbackToken, hashIdentity } from "../src/services/crypto.ts";
import { HMAC_KEY, jobBody, setup, VISITOR } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const OTHER = "ffffffffffffffffffffffffffffffff";
const GUARD = {
  composition: 0.71,
  colorDeltaE: 4,
  faces: { expected: 1, matched: 0 },
  passed: false,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

async function job(extra: Record<string, unknown> = {}, finish = true) {
  const h = await setup(extra);
  await h.pass();
  const created = await h.call("/v1/jobs", { method: "POST", body: jobBody(await h.upload()) });
  const jobId = created.body.jobId as string;
  if (finish) await h.advance(60_000);
  const retry = (body: Record<string, unknown>, visitor?: string) =>
    h.call(`/v1/jobs/${jobId}/retry`, { method: "POST", body, visitor });
  return { h, jobId, retry };
}

describe("POST /v1/jobs/:id/retry (spec 3.7)", () => {
  it("runs one free retry as a new version without using the daily quota", async () => {
    const { h, jobId, retry } = await job();
    const response = await retry({ attemptId: "a1", reason: "guard", guard: GUARD });
    expect(response.status).toBe(202);
    const running = await h.call(`/v1/jobs/${jobId}`);
    expect(running.body.attempts).toEqual([
      expect.objectContaining({ id: "a1", state: "succeeded", freeRetry: false }),
      expect.objectContaining({ id: "a2", state: "pending", freeRetry: true }),
    ]);
    await h.advance(120_000);
    const done = await h.call(`/v1/jobs/${jobId}`);
    expect(done.body.state).toBe("succeeded");
    expect((done.body.attempts as { state: string }[]).map((a) => a.state)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect((await h.call("/v1/quota")).body.remaining).toBe(1);
    const row = h.db.prepare("SELECT free_retry, retried_at FROM jobs WHERE id=?").get(jobId);
    expect(row).toEqual({ free_retry: 1, retried_at: NOON + 60_000 });
  });

  it("allows only one free retry per job", async () => {
    const { retry } = await job();
    await retry({ attemptId: "a1", reason: "thumbs_down", feedback: "face" });
    const second = await retry({ attemptId: "a1", reason: "thumbs_down" });
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("RETRY_NOT_ALLOWED");
  });

  it("needs failing guard metrics for a guard retry", async () => {
    const { retry } = await job();
    expect((await retry({ attemptId: "a1", reason: "guard" })).status).toBe(400);
  });

  it("refuses a retry before the job has finished", async () => {
    const { retry } = await job({}, false);
    expect((await retry({ attemptId: "a1", reason: "thumbs_down" })).status).toBe(409);
  });

  it("refuses retries on another browser's job", async () => {
    const { h, retry } = await job();
    await h.pass(OTHER);
    expect((await retry({ attemptId: "a1", reason: "thumbs_down" }, OTHER)).status).toBe(404);
  });

  it("refuses once this browser has used 3 free retries today", async () => {
    const { h, retry } = await job();
    const visitorHash = await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY);
    for (let i = 0; i < 3; i++)
      h.db
        .prepare(
          "INSERT INTO jobs(id,owner,visitor_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,free_retry,retried_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          `old${i}`,
          `g:${visitorHash}`,
          visitorHash,
          "ip",
          "unblur.std",
          "auto",
          "auto",
          "std",
          "p",
          `in/old${i}.jpg`,
          "{}",
          "{}",
          "succeeded",
          "{}",
          "free",
          `old-key-${i}`,
          1,
          NOON - 1_000 + i,
          NOON - 10_000 + i,
          NOON + 86_400_000,
        );
    expect((await retry({ attemptId: "a1", reason: "thumbs_down" })).body.error?.code).toBe(
      "RETRY_NOT_ALLOWED",
    );
  });
});

describe("POST /webhooks/kie/:jobId (spec 4.1)", () => {
  const instant = {
    FAKE_SCRIPT: JSON.stringify({
      "seedream/5-flash-image-to-image": [
        { kind: "success", pendingPolls: 0, outputUrl: "https://fake.test/a.png" },
      ],
    }),
  };
  const callback = async (h: Awaited<ReturnType<typeof setup>>, jobId: string, token?: string) =>
    h.call(`/webhooks/kie/${jobId}?t=${token ?? (await callbackToken(jobId, HMAC_KEY))}`, {
      method: "POST",
      body: { taskId: "ignored", state: "success" },
      headers: { origin: "" },
    });

  it("checks the job at once when kie calls back with a valid signature", async () => {
    const { h, jobId } = await job(instant, false);
    await h.advance(1_000);
    expect((await callback(h, jobId)).status).toBe(200);
    expect((await h.call(`/v1/jobs/${jobId}`)).body.state).toBe("succeeded");
  });

  it("rejects a callback with a bad signature", async () => {
    const { h, jobId } = await job(instant, false);
    expect((await callback(h, jobId, "0".repeat(64))).status).toBe(403);
    expect((await h.call(`/v1/jobs/${jobId}`)).body.state).toBe("submitted");
  });

  // Review focus 3: repeated and late callbacks.
  it("ignores duplicate and late callbacks for a finished job", async () => {
    const { h, jobId } = await job();
    const pointsBefore = h.analytics.length;
    for (let i = 0; i < 3; i++) expect((await callback(h, jobId)).status).toBe(200);
    const view = await h.call(`/v1/jobs/${jobId}`);
    expect(view.body).toMatchObject({ state: "succeeded", errorCode: null });
    expect((await h.call("/v1/quota")).body.remaining).toBe(1);
    expect(h.analytics.length).toBe(pointsBefore);
  });

  it("refuses a free retry once the admin has taken the capability offline", async () => {
    const { h, retry } = await job();
    h.kv.store.set("flags", JSON.stringify({ offline: ["unblur.std"] }));
    const { forgetFlags } = await import("../src/middleware/flags.ts");
    forgetFlags(h.env.KV as KVNamespace);
    const response = await retry({ attemptId: "a1", reason: "guard", guard: GUARD });
    expect(response.body.error?.code).toBe("PROVIDER_DOWN");
  });
});
