import { afterEach, describe, expect, it, vi } from "vitest";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

const ask = (h: Awaited<ReturnType<typeof setup>>, key: string, visitor?: string) =>
  h.call("/v1/uploads", {
    method: "POST",
    body: { contentType: "image/jpeg", bytes: 1_000 },
    headers: { "x-smoke-key": key },
    visitor,
  });
// A passed check gives that browser a human pass, so the wrong key comes from someone else.
const OTHER = "ffffffffffffffffffffffffffffffff";

describe("staging smoke key (spec 11.1)", () => {
  it("lets the post-deploy smoke script past the human check on staging", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const staging = await setup({
      SMOKE_KEY: "s".repeat(32),
      API_ORIGIN: "https://api-staging.videozombiecouple.com",
    });
    expect((await ask(staging, "s".repeat(32))).status).toBe(201);
    expect((await ask(staging, "x".repeat(32), OTHER)).body.error?.code).toBe("CHALLENGE_REQUIRED");
  });

  it("is ignored in production, and when unset or too short", async () => {
    const production = await setup({
      SMOKE_KEY: "s".repeat(32),
      API_ORIGIN: "https://api.videozombiecouple.com",
    });
    expect((await ask(production, "s".repeat(32))).body.error?.code).toBe("CHALLENGE_REQUIRED");
    const unset = await setup({ API_ORIGIN: "https://api-staging.videozombiecouple.com" });
    expect((await ask(unset, "")).body.error?.code).toBe("CHALLENGE_REQUIRED");
    const short = await setup({
      SMOKE_KEY: "abc",
      API_ORIGIN: "https://api-staging.videozombiecouple.com",
    });
    expect((await ask(short, "abc")).body.error?.code).toBe("CHALLENGE_REQUIRED");
  });

  it("works only on staging (and locally), never on any other origin", async () => {
    for (const origin of [
      "https://api.videozombiecouple.com/",
      "https://api2.videozombiecouple.com",
      "https://api.example.com",
    ]) {
      const h = await setup({ SMOKE_KEY: "s".repeat(32), API_ORIGIN: origin });
      expect((await ask(h, "s".repeat(32))).body.error?.code).toBe("CHALLENGE_REQUIRED");
    }
  });
});
