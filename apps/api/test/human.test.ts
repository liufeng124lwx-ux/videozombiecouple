import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail } from "../src/http.ts";
import { identity } from "../src/middleware/identity.ts";
import { HUMAN_PASS_USES, requireHuman } from "../src/services/human-pass.ts";
import type { AppEnv } from "../src/types.ts";
import { IP, setup, VISITOR } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const guarded = new Hono<AppEnv>();
guarded.use("*", async (c, next) => {
  c.set("requestId", "req");
  await next();
});
guarded.use("*", identity());
guarded.post("/x", async (c) =>
  (await requireHuman(c)) ? c.json({ ok: true }) : fail(c, "CHALLENGE_REQUIRED"),
);

async function post(env: unknown, headers: Record<string, string> = {}, ip = IP) {
  const response = await guarded.request(
    "/x",
    { method: "POST", headers: { cookie: `vid=${VISITOR}`, "CF-Connecting-IP": ip, ...headers } },
    env as never,
  );
  return response.status;
}

function siteverify(answer: Record<string, unknown>) {
  const fetchMock = vi.fn(async () => Response.json(answer));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requireHuman (spec 7.1)", () => {
  it("asks for a challenge when there is neither a token nor a pass", async () => {
    const { env } = await setup();
    expect(await post(env)).toBe(403);
  });

  it("accepts a valid Turnstile token and grants a pass for later requests", async () => {
    const { env } = await setup();
    const fetchMock = siteverify({
      success: true,
      hostname: "videozombiecouple.com",
      action: "job",
    });
    expect(await post(env, { "x-turnstile": "token" })).toBe(200);
    expect(await post(env)).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a token for another hostname or action", async () => {
    const { env } = await setup();
    siteverify({ success: true, hostname: "evil.example", action: "job" });
    expect(await post(env, { "x-turnstile": "token" })).toBe(403);
    siteverify({ success: true, hostname: "videozombiecouple.com", action: "login" });
    expect(await post(env, { "x-turnstile": "token" })).toBe(403);
  });

  it("binds the pass to the IP segment it was granted on", async () => {
    const h = await setup();
    await h.pass();
    expect(await post(h.env, {}, "198.51.100.7")).toBe(403);
  });

  it("runs out after its uses and after 30 minutes", async () => {
    const h = await setup();
    await h.pass();
    for (let i = 0; i < HUMAN_PASS_USES; i++) expect(await post(h.env)).toBe(200);
    expect(await post(h.env)).toBe(403);
    await h.pass();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect(await post(h.env)).toBe(403);
  });
});
