import { describe, expect, it, vi } from "vitest";
import { apiError, mockApi } from "../test/mock-api.ts";
import { ApiError, api, apiOrigin, post } from "./api.ts";

describe("api client", () => {
  it("calls the API origin with the session cookie", async () => {
    const { calls, fetchMock } = mockApi({ "GET /v1/me": { body: { user: null } } });
    expect(await api("/v1/me")).toEqual({ user: null });
    expect(apiOrigin()).toBe("http://localhost:8787");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "include" });
    expect(calls[0]?.path).toBe("/v1/me");
  });

  it("posts JSON with extra headers", async () => {
    const { calls } = mockApi({ "POST /v1/auth/email": { status: 202, body: { sent: true } } });
    await post("/v1/auth/email", { email: "a@b.co" }, { "x-turnstile": "tok" });
    expect(calls[0]).toMatchObject({
      method: "POST",
      body: { email: "a@b.co" },
      headers: { "content-type": "application/json", "x-turnstile": "tok" },
    });
  });

  it("turns error bodies into ApiError with the code and wait time", async () => {
    mockApi({ "GET /v1/quota": apiError("RATE_LIMITED", 429, 30) });
    await expect(api("/v1/quota")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAfterSec: 30,
    });
  });

  it("reports a failed connection as NETWORK and a bare 500 as INTERNAL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(api("/v1/me")).rejects.toEqual(new ApiError("NETWORK"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    await expect(api("/v1/me")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
