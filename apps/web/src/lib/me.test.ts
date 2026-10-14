import { describe, expect, it } from "vitest";
import { mockApi } from "../test/mock-api.ts";
import { loadMe, refreshMe } from "./me.ts";

const GUEST = { user: null, owner: "g", credits: null, banner: null };

describe("me", () => {
  it("shares one request between islands and refetches on demand", async () => {
    const { calls } = mockApi({ "GET /v1/me": { body: GUEST } });
    await refreshMe();
    await Promise.all([loadMe(), loadMe()]);
    expect(calls).toHaveLength(1);
    await refreshMe();
    expect(calls).toHaveLength(2);
  });

  it("gives null when the API cannot be reached", async () => {
    mockApi({ "GET /v1/me": { status: 503, body: {} } });
    expect(await refreshMe()).toBeNull();
  });
});
