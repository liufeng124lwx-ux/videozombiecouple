import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobBody, setup } from "./harness.ts";

const NOON = Date.UTC(2026, 9, 9, 12);
const OTHER = "ffffffffffffffffffffffffffffffff";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOON);
});
afterEach(() => vi.useRealTimers());

async function ready(extra: Record<string, unknown> = {}) {
  const h = await setup(extra);
  await h.pass();
  const create = async (body: Record<string, unknown>, visitor?: string) =>
    h.call("/v1/jobs", { method: "POST", body, visitor });
  return { h, create };
}

describe("POST /v1/jobs and GET /v1/jobs/:id (spec 4.1)", () => {
  it("creates a job and serves its progress, then signed result links", async () => {
    const { h, create } = await ready();
    const key = await h.upload();
    const created = await create(jobBody(key));
    expect(created.status).toBe(201);
    const jobId = created.body.jobId as string;
    expect(jobId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const running = await h.call(`/v1/jobs/${jobId}`);
    expect(running.status).toBe(200);
    expect(running.body).toMatchObject({
      id: jobId,
      capability: "unblur.std",
      mode: "auto",
      state: "submitted",
      queuePosition: null,
      etaMs: 29_000,
      attempts: [
        { id: "a1", label: "Seedream", state: "pending", resultUrl: null, freeRetry: false },
      ],
      charge: { kind: "quota", credits: 0 },
      errorCode: null,
      expiresAt: NOON + 24 * 3_600_000,
    });
    expect(new URL(running.body.inputUrl as string).pathname).toBe(`/vzc-test/${key}`);

    await h.advance(60_000);
    const done = await h.call(`/v1/jobs/${jobId}`);
    expect(done.body.state).toBe("succeeded");
    const attempt = (done.body.attempts as { resultUrl: string }[])[0];
    expect(new URL(attempt?.resultUrl as string).pathname).toBe(`/vzc-test/out/${jobId}/a1.png`);

    const row = h.db
      .prepare("SELECT mode_source, tier, crop_box, diagnosis, prompt_version FROM jobs WHERE id=?")
      .get(jobId) as Record<string, string>;
    expect(row).toMatchObject({ mode_source: "auto", tier: "std", prompt_version: "2026-10-09.1" });
    expect(JSON.parse(row.crop_box as string)).toEqual({ x: 0, y: 0.0625, w: 1, h: 0.875 });
    expect(JSON.parse(row.diagnosis as string)).toMatchObject({ blur: "motion" });
  });

  // Review focus 1: a double click sends the same idempotency key twice at once.
  it("returns the same job for a repeated idempotency key, even when the requests race", async () => {
    const { h, create } = await ready();
    const key = await h.upload();
    const [a, b] = await Promise.all([create(jobBody(key)), create(jobBody(key))]);
    expect(a.body.jobId).toBe(b.body.jobId);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect((h.db.prepare("SELECT COUNT(*) AS n FROM jobs").get() as { n: number }).n).toBe(1);
    expect((await h.call("/v1/quota")).body.remaining).toBe(1);
  });

  // Final review: a transient error inside the runner's first pass must not lose the job.
  it("still returns the job when the runner's first pass hits a transient error", async () => {
    const { h, create } = await ready();
    const pool = h.dispatchers.instance("kie-image");
    const acquire = pool.acquire.bind(pool);
    pool.acquire = async () => {
      throw new Error("Dispatcher overloaded");
    };
    const created = await create(jobBody(await h.upload()));
    expect(created.status).toBe(201);
    pool.acquire = acquire;
    await h.advance(60_000);
    expect((await h.call(`/v1/jobs/${created.body.jobId}`)).body.state).toBe("succeeded");
  });

  it("handles a double click on the last free use as one job", async () => {
    const { h, create } = await ready();
    expect((await create(jobBody(await h.upload()))).status).toBe(201);
    const key = await h.upload();
    // Slow inserts let the second request check the quota while the first is still writing.
    const db = h.env.DB as D1Database;
    const prepare = db.prepare.bind(db);
    db.prepare = (query: string) => {
      const statement = prepare(query);
      if (!query.startsWith("INSERT INTO jobs")) return statement;
      return {
        bind: (...values: unknown[]) => {
          const bound = statement.bind(...values);
          return {
            run: async () => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return bound.run();
            },
          };
        },
      } as unknown as D1PreparedStatement;
    };
    const [a, b] = await Promise.all([create(jobBody(key)), create(jobBody(key))]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.jobId).toBe(b.body.jobId);
    db.prepare = prepare;
    expect((await h.call("/v1/quota")).body.remaining).toBe(0);
  });

  it("validates the request body", async () => {
    const { h, create } = await ready();
    expect((await create({})).body.error?.code).toBe("BAD_REQUEST");
    expect((await create(jobBody("out/01JA8Z9X3K7M2N4P6Q8R0S1T2V.jpg"))).status).toBe(400);
    expect((await h.call("/v1/jobs", { method: "POST", body: "not json" })).status).toBe(400);
  });

  it("asks guests for credits on Pro and 4K without touching the free quota", async () => {
    const { h, create } = await ready();
    const key = await h.upload();
    const response = await create(jobBody(key, { capability: "unblur.pro" }));
    expect(response.status).toBe(402);
    expect(response.body.error?.code).toBe("CREDITS_LOW");
    expect((await h.call("/v1/quota")).body.remaining).toBe(2);
  });

  it("refuses another browser's upload", async () => {
    const { h, create } = await ready();
    const key = await h.upload();
    await h.pass(OTHER);
    expect((await create(jobBody(key), OTHER)).body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses photos that are not a padded JPEG", async () => {
    const { h, create } = await ready();
    const unpadded = await h.upload({ width: 1000, height: 900 });
    expect((await create(jobBody(unpadded))).body.error?.code).toBe("FILE_UNSUPPORTED");
    const png = await h.upload();
    await (h.env.BUCKET as R2Bucket).put(png, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect((await create(jobBody(png))).body.error?.code).toBe("FILE_UNSUPPORTED");
    expect((await h.call("/v1/quota")).body.remaining).toBe(2);
  });

  it("stops at two free photos a day per browser", async () => {
    const { h, create } = await ready();
    for (let i = 0; i < 2; i++) expect((await create(jobBody(await h.upload()))).status).toBe(201);
    const third = await create(jobBody(await h.upload()));
    expect(third.status).toBe(402);
    expect(third.body.error?.code).toBe("QUOTA_EXHAUSTED");
  });

  it("gives the free use back when the job fails", async () => {
    const { h, create } = await ready({
      FAKE_SCRIPT: JSON.stringify({
        "seedream/5-flash-image-to-image": [
          { kind: "submit_error", code: 422, msg: "image could not be processed" },
        ],
      }),
    });
    const created = await create(jobBody(await h.upload()));
    const job = await h.call(`/v1/jobs/${created.body.jobId}`);
    expect(job.body).toMatchObject({ state: "failed", errorCode: "FILE_UNSUPPORTED" });
    expect((await h.call("/v1/quota")).body.remaining).toBe(2);
  });

  it("pauses free jobs while the free-tier breaker is open", async () => {
    const { h, create } = await ready();
    h.kv.store.set("flags", JSON.stringify({ freePaused: true }));
    const response = await create(jobBody(await h.upload()));
    expect(response.status).toBe(503);
    expect(response.body.error?.code).toBe("FREE_TIER_PAUSED");
  });

  it("allows 5 job requests a minute per browser", async () => {
    const { h, create } = await ready();
    const body = jobBody(await h.upload());
    for (let i = 0; i < 5; i++) expect((await create(body)).status).toBeLessThan(300);
    const limited = await create(body);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(limited.body.error?.retryAfterSec).toBe(60);
  });

  it("needs a human pass", async () => {
    const h = await setup();
    const response = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody("in/01JA8Z9X3K7M2N4P6Q8R0S1T2V.jpg"),
    });
    expect(response.body.error?.code).toBe("CHALLENGE_REQUIRED");
  });

  it("shows a job only to the browser that created it", async () => {
    const { h, create } = await ready();
    const created = await create(jobBody(await h.upload()));
    expect((await h.call(`/v1/jobs/${created.body.jobId}`, { visitor: OTHER })).status).toBe(404);
    expect((await h.call("/v1/jobs/not-a-job")).status).toBe(404);
    expect((await h.call("/v1/jobs/01JA8Z9X3K7M2N4P6Q8R0S1T2V")).status).toBe(404);
  });

  it("limits status polling to 5 requests a second", async () => {
    const { h, create } = await ready();
    const created = await create(jobBody(await h.upload()));
    for (let i = 0; i < 5; i++)
      expect((await h.call(`/v1/jobs/${created.body.jobId}`)).status).toBe(200);
    expect((await h.call(`/v1/jobs/${created.body.jobId}`)).status).toBe(429);
  });

  it("reports expired jobs without links after the retention period", async () => {
    const { h, create } = await ready();
    const created = await create(jobBody(await h.upload()));
    await h.advance(25 * 3_600_000);
    const view = await h.call(`/v1/jobs/${created.body.jobId}`);
    expect(view.body).toMatchObject({ state: "expired", inputUrl: null });
    expect((view.body.attempts as { resultUrl: unknown }[])[0]?.resultUrl).toBeNull();
  });
});
