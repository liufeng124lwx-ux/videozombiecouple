import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jobBody, jpeg, setup } from "./harness.ts";
import { SESSION, signWebhook, TOKEN, waffoApi, waffoEvent, waffoKit } from "./waffo-kit.ts";

const GUARD = {
  composition: 0.71,
  colorDeltaE: 4,
  faces: { expected: 1, matched: 0 },
  passed: false,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ success: true, hostname: "videozombiecouple.com", action: "job" }),
    ),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("worker entry", () => {
  it("exports the app and the three Durable Object classes", async () => {
    const worker = await import("../src/index.ts");
    expect(typeof worker.default.fetch).toBe("function");
    expect(typeof worker.RateLimiter).toBe("function");
    expect(typeof worker.Dispatcher).toBe("function");
    expect(typeof worker.JobRunner).toBe("function");
    expect(typeof worker.Wallet).toBe("function");
  });
});

describe("a guest's day with FAKE_PROVIDER=1", () => {
  it("uploads, waits, downloads, gets a free redo, and runs out after two photos", async () => {
    const h = await setup();
    expect((await h.call("/v1/quota")).body).toMatchObject({ remaining: 2, limit: 2 });

    // The page shows Turnstile once; the token is spent on the first upload.
    const upload = async (token?: string) => {
      const response = await h.call("/v1/uploads", {
        method: "POST",
        body: { contentType: "image/jpeg", bytes: 900_000 },
        headers: token ? { "x-turnstile": token } : {},
      });
      expect(response.status).toBe(201);
      await (h.env.BUCKET as R2Bucket).put(response.body.key as string, jpeg(2048, 1536));
      return response.body.key as string;
    };
    const poll = async (jobId: string) => {
      for (let i = 0; i < 100; i++) {
        const view = await h.call(`/v1/jobs/${jobId}`);
        const attempts = view.body.attempts as { state: string }[];
        if (view.body.state === "succeeded" && attempts.every((a) => a.state !== "pending"))
          return view.body;
        await h.advance(2_000);
      }
      throw new Error("job did not finish");
    };

    const first = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await upload("turnstile-token")),
    });
    expect(first.status).toBe(201);
    const jobId = first.body.jobId as string;
    const result = await poll(jobId);
    expect((result.attempts as { resultUrl: string }[])[0]?.resultUrl).toContain(
      `/out/${jobId}/a1.png`,
    );
    expect((await h.call("/v1/quota")).body.remaining).toBe(1);

    const redo = await h.call(`/v1/jobs/${jobId}/retry`, {
      method: "POST",
      body: { attemptId: "a1", reason: "guard", guard: GUARD },
    });
    expect(redo.status).toBe(202);
    const redone = await poll(jobId);
    expect((redone.attempts as unknown[]).length).toBe(2);
    expect((await h.call("/v1/quota")).body.remaining).toBe(1);

    const second = await h.call("/v1/jobs", { method: "POST", body: jobBody(await upload()) });
    await poll(second.body.jobId as string);
    expect((await h.call("/v1/quota")).body.remaining).toBe(0);

    const third = await h.call("/v1/jobs", { method: "POST", body: jobBody(await upload()) });
    expect(third.body.error?.code).toBe("QUOTA_EXHAUSTED");
  });
});

describe("a guest who signs up and pays with credits", () => {
  it("runs out of free photos, signs up, keeps going on the bonus and sees the ledger", async () => {
    const h = await setup();
    await h.pass();
    const upload = async () => {
      const r = await h.call("/v1/uploads", {
        method: "POST",
        body: { contentType: "image/jpeg", bytes: 900_000 },
      });
      await (h.env.BUCKET as R2Bucket).put(r.body.key as string, jpeg(2048, 1536));
      return r.body.key as string;
    };
    for (let i = 0; i < 2; i++)
      expect(
        (await h.call("/v1/jobs", { method: "POST", body: jobBody(await upload()) })).status,
      ).toBe(201);
    expect(
      (await h.call("/v1/jobs", { method: "POST", body: jobBody(await upload()) })).body.error
        ?.code,
    ).toBe("QUOTA_EXHAUSTED");

    await h.call("/v1/auth/email", { method: "POST", body: { email: "ann@example.com" } });
    const code = /\b(\d{6})\b/.exec(h.mail[0]?.subject ?? "")?.[1];
    const login = await h.call("/v1/auth/code", {
      method: "POST",
      body: { email: "ann@example.com", code },
    });
    const session = /upx_sess=([a-f0-9]{64})/.exec(login.headers.getSetCookie().join(";"))?.[1];
    expect((await h.call("/v1/me", { session })).body.credits).toBe(5);
    expect((await h.call("/v1/quota", { session })).body.remaining).toBe(2);

    const pro = await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await upload(), { capability: "unblur.pro" }),
      session,
    });
    expect(pro.status).toBe(201);
    await h.advance(120_000);
    expect((await h.call(`/v1/jobs/${pro.body.jobId}`, { session })).body.state).toBe("succeeded");
    expect((await h.call("/v1/me", { session })).body.credits).toBe(2);
    const ledger = await h.call("/v1/account/ledger", { session });
    expect(
      (ledger.body.entries as { type: string; delta: number }[]).map((e) => [e.type, e.delta]),
    ).toEqual([
      ["reserve", -3],
      ["grant", 5],
    ]);
  });
});

describe("a member who buys a pack, spends it and is refunded", () => {
  it("checks out, gets the credits from the webhook, and loses them on refund", async () => {
    const kit = await waffoKit();
    const h = await setup(kit.env);
    await h.pass();
    const { userId, session } = await h.signIn("ann@example.com");
    waffoApi({
      [TOKEN]: { data: { token: "tok" } },
      [SESSION]: { data: { sessionId: "cs", checkoutUrl: "https://checkout.waffo.ai/store/x/cs" } },
    });
    const checkout = await h.call("/v1/billing/checkout", {
      method: "POST",
      body: { productKey: "pack60", returnPath: "/unblur-photo" },
      session,
    });
    expect(checkout.status).toBe(200);

    const order = `ORD_${"j".repeat(22)}`;
    const deliver = async (event: ReturnType<typeof waffoEvent>) =>
      h.call("/webhooks/waffo", {
        method: "POST",
        body: event,
        headers: {
          "x-waffo-signature": await signWebhook(JSON.stringify(event), kit.keys.privateKey),
        },
      });
    const paid = await deliver(
      waffoEvent("order.completed", {
        orderId: order,
        merchantProvidedBuyerIdentity: userId,
        productMetadata: { productKey: "pack60" },
        chargedAmount: "4.99",
      }),
    );
    expect(paid.status).toBe(200);
    expect((await h.call("/v1/me", { session })).body.credits).toBe(60);

    const upload = async () => {
      const r = await h.call("/v1/uploads", {
        method: "POST",
        body: { contentType: "image/jpeg", bytes: 900_000 },
        session,
      });
      await (h.env.BUCKET as R2Bucket).put(r.body.key as string, jpeg(2048, 1536));
      return r.body.key as string;
    };
    await h.call("/v1/jobs", {
      method: "POST",
      body: jobBody(await upload(), { capability: "unblur.pro" }),
      session,
    });
    await h.advance(120_000);
    expect((await h.call("/v1/me", { session })).body.credits).toBe(57);

    await deliver(
      waffoEvent("refund.succeeded", {
        orderId: order,
        refundedAmount: "4.99",
        originalChargedAmount: "4.99",
      }),
    );
    expect((await h.call("/v1/me", { session })).body.credits).toBe(0);
    expect((await h.call("/v1/billing", { session })).body.refundDebt).toBe(3);
  });
});
