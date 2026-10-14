import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocal, LOCAL_TURNSTILE_TOKEN } from "../src/local.ts";
import { app } from "../src/router.ts";
import { presign } from "../src/services/r2-presign.ts";
import type { Bindings } from "../src/types.ts";
import { setup } from "./harness.ts";

afterEach(() => vi.unstubAllGlobals());

const API = "http://localhost:8787";
const SITE = "http://localhost:4398";
const LOCAL = { LOCAL_DEV: "1", API_ORIGIN: API, ALLOWED_ORIGIN: SITE };

describe("local mode for end-to-end runs", () => {
  it("is only on with the flag and a localhost API", () => {
    expect(isLocal({ LOCAL_DEV: "1", API_ORIGIN: API } as Bindings)).toBe(true);
    expect(isLocal({ LOCAL_DEV: "1", API_ORIGIN: "http://127.0.0.1:8787" } as Bindings)).toBe(true);
    expect(
      isLocal({ LOCAL_DEV: "1", API_ORIGIN: "https://api.videozombiecouple.com" } as Bindings),
    ).toBe(false);
    expect(isLocal({ LOCAL_DEV: "1", API_ORIGIN: "http://localhost.evil.com" } as Bindings)).toBe(
      false,
    );
    expect(isLocal({ API_ORIGIN: API } as Bindings)).toBe(false);
  });

  it("serves signed uploads and downloads from the bucket binding", async () => {
    const h = await setup(LOCAL);
    const env = h.env as unknown as Bindings;
    const put = await presign(env, "in/abc/photo.jpg", "PUT", 600);
    expect(put.startsWith(`${API}/local-r2/in/abc/photo.jpg?`)).toBe(true);
    const path = put.slice(API.length);
    const preflight = await app.request(
      path,
      { method: "OPTIONS", headers: { origin: SITE } },
      h.env,
    );
    expect(preflight.status).toBe(204);
    const stored = await app.request(
      path,
      {
        method: "PUT",
        body: "jpeg-bytes",
        headers: { "content-type": "image/jpeg", origin: SITE },
      },
      h.env,
    );
    expect(stored.status).toBe(200);
    expect(stored.headers.get("access-control-allow-origin")).toBe(SITE);
    const get = (await presign(env, "in/abc/photo.jpg", "GET", 600)).slice(API.length);
    const read = await app.request(get, {}, h.env);
    expect(await read.text()).toBe("jpeg-bytes");
    expect(read.headers.get("content-type")).toBe("image/jpeg");
    // A PUT link can't be used to read, a changed key breaks the signature, and links expire.
    expect((await app.request(path, {}, h.env)).status).toBe(403);
    expect((await app.request(get.replace("photo", "other"), {}, h.env)).status).toBe(403);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 601_000);
    expect((await app.request(get, {}, h.env)).status).toBe(403);
    vi.useRealTimers();
  });

  it("does not exist outside local mode", async () => {
    const h = await setup({ LOCAL_DEV: "1" });
    expect(
      (await app.request("/local-r2/in/x.jpg?m=GET&exp=9999999999&sig=x", {}, h.env)).status,
    ).toBe(404);
    expect(
      (await presign(h.env as unknown as Bindings, "in/x.jpg", "GET", 60)).startsWith("https://"),
    ).toBe(true);
  });

  it("accepts the fixed Turnstile token locally, and only locally", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("no network in tests");
    });
    const ask = (h: Awaited<ReturnType<typeof setup>>) =>
      h.call("/v1/uploads", {
        method: "POST",
        body: { contentType: "image/jpeg", bytes: 1_000 },
        headers: { "x-turnstile": LOCAL_TURNSTILE_TOKEN },
      });
    expect((await ask(await setup({ LOCAL_DEV: "1", API_ORIGIN: API }))).status).toBe(201);
    expect((await ask(await setup())).body.error?.code).toBe("CHALLENGE_REQUIRED");
  });

  it("is never switched on by a deployable config", () => {
    for (const file of ["wrangler.jsonc", "wrangler.production.jsonc"]) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      expect(text).not.toContain("LOCAL_DEV");
    }
  });
});
