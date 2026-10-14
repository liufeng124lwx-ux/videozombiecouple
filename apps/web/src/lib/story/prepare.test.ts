import { FILE_LIMITS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { createRaster, type Raster } from "../image/raster.ts";
import { type PrepareDeps, preparePhoto } from "./prepare.ts";

const file = (bytes = 10) => new File([new Uint8Array(bytes)], "me.jpg", { type: "image/jpeg" });

function deps(over: Partial<PrepareDeps> = {}): PrepareDeps & { encoded: Raster[] } {
  const encoded: Raster[] = [];
  return {
    encoded,
    decode: async () => createRaster(3000, 2000),
    detect: async () => [{ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }],
    encode: async (r) => {
      encoded.push(r);
      return new Blob(["jpeg"], { type: "image/jpeg" });
    },
    ...over,
  };
}

describe("preparePhoto", () => {
  it("rejects unreadable photos before upload", async () => {
    const d = deps({ decode: async () => Promise.reject(new Error("FILE_UNSUPPORTED")) });
    await expect(preparePhoto(file(), "face", d)).resolves.toMatchObject({
      ok: false,
      code: "FILE_UNSUPPORTED",
    });
  });

  it("rejects files over the size limit without decoding them", async () => {
    let decoded = false;
    const d = deps({ decode: async () => ((decoded = true), createRaster(10, 10)) });
    await expect(preparePhoto(file(FILE_LIMITS.maxBytes + 1), "face", d)).resolves.toMatchObject({
      ok: false,
      code: "FILE_TOO_LARGE",
    });
    expect(decoded).toBe(false);
  });

  it("rejects photos too small for a face", async () => {
    const d = deps({ decode: async () => createRaster(300, 300) });
    await expect(preparePhoto(file(), "face", d)).resolves.toMatchObject({
      ok: false,
      code: "FILE_UNSUPPORTED",
    });
  });

  it("re-encodes to a JPEG of at most 2048 px and reports one face as ok", async () => {
    const d = deps();
    const result = await preparePhoto(file(), "face", d);
    expect(result).toMatchObject({ ok: true, face: "ok" });
    expect(Math.max(d.encoded[0]!.width, d.encoded[0]!.height)).toBe(2048);
  });

  it("face check blocks zero or many faces, and lets it through when the detector can't run", async () => {
    expect(await preparePhoto(file(), "face", deps({ detect: async () => [] }))).toMatchObject({
      ok: true,
      face: "none",
    });
    const two = [
      { x: 0, y: 0, w: 0.2, h: 0.3 },
      { x: 0.5, y: 0, w: 0.2, h: 0.3 },
    ];
    expect(await preparePhoto(file(), "face", deps({ detect: async () => two }))).toMatchObject({
      ok: true,
      face: "many",
    });
    expect(await preparePhoto(file(), "face", deps({ detect: async () => null }))).toMatchObject({
      ok: true,
      face: "unknown",
    });
  });

  it("skips the face check for the pet photo", async () => {
    let detected = false;
    const d = deps({ detect: async () => ((detected = true), []) });
    expect(await preparePhoto(file(), "pet", d)).toMatchObject({ ok: true, face: "skipped" });
    expect(detected).toBe(false);
  });
});
