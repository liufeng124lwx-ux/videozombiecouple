import { describe, expect, it } from "vitest";
import { app } from "../src/router.ts";

const ORIGIN = "https://videozombiecouple.com";
const env = { ALLOWED_ORIGIN: ORIGIN } as never;

describe("app", () => {
  it("answers health checks without an Origin and tags every response with a request id", async () => {
    const response = await app.request("/health", {}, env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects /v1 calls without our Origin", async () => {
    for (const origin of [undefined, "https://evil.example"]) {
      const response = await app.request(
        "/v1/stories",
        { method: "POST", headers: origin ? { origin } : {} },
        env,
      );
      expect(response.status).toBe(403);
    }
  });

  it("answers CORS preflight for our Origin", async () => {
    const response = await app.request(
      "/v1/stories",
      { method: "OPTIONS", headers: { origin: ORIGIN } },
      env,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-turnstile");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-device");
  });

  it("returns NOT_FOUND as a JSON error body", async () => {
    const response = await app.request("/nope", {}, env);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });
});
