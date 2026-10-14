import { describe, expect, it } from "vitest";
import { presign } from "../src/services/r2-presign.ts";
import type { Bindings } from "../src/types.ts";
import { ORIGIN, setup } from "./harness.ts";

/** Without R2 S3 keys, signed links point at the API's own /files route. */
async function proxied() {
  const h = await setup({ R2_ACCESS_KEY_ID: "", R2_SECRET_ACCESS_KEY: "" });
  const env = h.env as unknown as Bindings;
  const path = (url: string) => url.replace(env.API_ORIGIN, "");
  return { h, env, path };
}

describe("worker-signed file links", () => {
  it("signs a link to the API when there are no R2 keys", async () => {
    const { env } = await proxied();
    const url = await presign(env, "out/S1/video.mp4", "GET", 60);
    expect(url.startsWith(`${env.API_ORIGIN}/files/out/S1/video.mp4?`)).toBe(true);
  });

  it("uploads with the declared size and type, then serves the bytes back", async () => {
    const { h, env, path } = await proxied();
    const put = await presign(env, "in/K.jpg", "PUT", 60, {
      "content-length": "4",
      "content-type": "image/jpeg",
    });
    const ok = await h.raw(path(put), {
      method: "PUT",
      headers: { "content-type": "image/jpeg", "content-length": "4" },
      body: new Uint8Array([1, 2, 3, 4]),
    });
    expect(ok.status).toBe(200);
    const get = await presign(env, "in/K.jpg", "GET", 60);
    const back = await h.raw(path(get));
    expect(back.status).toBe(200);
    expect(back.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("refuses a different size or type than the signed one", async () => {
    const { h, env, path } = await proxied();
    const put = await presign(env, "in/K.jpg", "PUT", 60, {
      "content-length": "4",
      "content-type": "image/jpeg",
    });
    const big = await h.raw(path(put), {
      method: "PUT",
      headers: { "content-type": "image/jpeg", "content-length": "5" },
      body: new Uint8Array(5),
    });
    expect(big.status).toBe(403);
    const png = await h.raw(path(put), {
      method: "PUT",
      headers: { "content-type": "image/png", "content-length": "4" },
      body: new Uint8Array(4),
    });
    expect(png.status).toBe(403);
  });

  it("refuses expired, tampered or wrong-method links", async () => {
    const { h, env, path } = await proxied();
    await h.r2.BUCKET.put("out/S1/video.mp4", new Uint8Array([9]));
    const get = await presign(env, "out/S1/video.mp4", "GET", 60);
    expect((await h.raw(path(get).replace("out/S1", "out/S2"))).status).toBe(403);
    expect((await h.raw(path(get), { method: "PUT", body: new Uint8Array(1) })).status).toBe(403);
    const old = await presign(env, "out/S1/video.mp4", "GET", -1);
    expect((await h.raw(path(old))).status).toBe(403);
  });

  it("serves byte ranges so the player can seek", async () => {
    const { h, env, path } = await proxied();
    await h.r2.BUCKET.put("out/S1/video.mp4", new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
      httpMetadata: { contentType: "video/mp4" },
    });
    const get = await presign(env, "out/S1/video.mp4", "GET", 60);
    const part = await h.raw(path(get), { headers: { range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([2, 3, 4, 5]));
  });

  it("lets the site's origin upload from the browser (CORS)", async () => {
    const { h } = await proxied();
    const pre = await h.raw("/files/in/K.jpg", {
      method: "OPTIONS",
      headers: { origin: ORIGIN, "access-control-request-method": "PUT" },
    });
    expect(pre.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });
});
