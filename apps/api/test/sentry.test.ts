import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CRONS, runCron } from "../src/ops/cron.ts";
import { report, reportRequest, scrub } from "../src/services/sentry.ts";
import type { AppEnv, Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

const DSN = "https://public@o0.ingest.sentry.io/1";
afterEach(() => vi.unstubAllGlobals());

function capture() {
  const bodies: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).includes("ingest.sentry.io")) bodies.push(String(init?.body));
    return new Response("{}");
  });
  return bodies;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("Sentry (spec 8.4)", () => {
  it("strips signed-link secrets from what it sends", () => {
    expect(
      scrub("GET https://r2/x.jpg?X-Amz-Signature=abc&X-Amz-Credential=key&ok=1 sig=zzz"),
    ).toBe(
      "GET https://r2/x.jpg?X-Amz-Signature=[removed]&X-Amz-Credential=[removed]&ok=1 sig=[removed]",
    );
  });

  it("reports an API error with its request id, without cookies, query strings or emails", async () => {
    const bodies = capture();
    const h = await setup({ SENTRY_DSN: DSN });
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("requestId", "req-123");
      c.set("userId", "user-9");
      await next();
    });
    app.get("/boom", () => {
      throw new Error("failed to fetch https://r2/x?X-Amz-Signature=topsecret for a@b.com");
    });
    app.onError((error, c) => {
      reportRequest(c, error);
      return c.text("INTERNAL", 500);
    });
    const response = await app.request(
      "/boom?token=querysecret",
      { headers: { cookie: "upx_sess=cookiesecret" } },
      h.env,
    );
    expect(response.status).toBe(500);
    await settle();
    expect(bodies).toHaveLength(1);
    const sent = bodies[0] ?? "";
    expect(sent).toContain("req-123");
    expect(sent).toContain("user-9");
    for (const secret of ["topsecret", "querysecret", "cookiesecret", "a@b.com"])
      expect(sent).not.toContain(secret);
  });

  it("does nothing without a DSN", async () => {
    const bodies = capture();
    const h = await setup();
    report(h.env as unknown as Bindings, new Error("x"), { task: "cleanup" });
    await settle();
    expect(bodies).toEqual([]);
  });

  it("reports an ops task that fails, tagged with the task", async () => {
    const bodies = capture();
    const h = await setup({ SENTRY_DSN: DSN });
    const broken = {
      ...h.env,
      DB: {
        prepare: () => {
          throw new Error("D1 is down");
        },
      },
    } as unknown as Bindings;
    const waits: Promise<unknown>[] = [];
    await runCron(CRONS.fiveMinutes, broken, Date.now(), async () => {}, {
      waitUntil: (p) => void waits.push(p),
    });
    await settle();
    expect(bodies.some((b) => b.includes("D1 is down") && b.includes("free-tier"))).toBe(true);
    expect(waits.length).toBeGreaterThan(0);
  });
});
