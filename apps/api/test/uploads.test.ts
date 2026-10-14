import { UploadKeySchema } from "@vzc/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashIdentity } from "../src/services/crypto.ts";
import { ulid } from "../src/services/ids.ts";
import { jpegSize } from "../src/services/jpeg.ts";
import { presign } from "../src/services/r2-presign.ts";
import { checkUpload } from "../src/services/upload-check.ts";
import type { Bindings } from "../src/types.ts";
import { HMAC_KEY, jpeg, setup, VISITOR } from "./harness.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 9, 12));
});
afterEach(() => vi.useRealTimers());

describe("ulid", () => {
  it("makes sortable 26-character ids that fit the upload key pattern", () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(UploadKeySchema.safeParse(`in/${a}.jpg`).success).toBe(true);
  });
});

describe("jpegSize", () => {
  it("reads width and height from the SOF marker", () => {
    expect(jpegSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 });
  });

  it("rejects bytes that are not a readable JPEG", () => {
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegSize(jpeg(10, 10).slice(0, 12))).toBeNull();
    expect(jpegSize(jpeg(0, 10))).toBeNull();
  });
});

describe("presign", () => {
  it("signs an R2 URL in the query string with the given lifetime", async () => {
    const { env } = await setup();
    const url = new URL(await presign(env as unknown as Bindings, "in/A.jpg", "PUT", 600));
    expect(url.host).toBe("test-account.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/vzc-test/in/A.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("checkUpload (spec 3.2, 7.2)", () => {
  async function uploaded(bytes: Uint8Array, owner = VISITOR) {
    const h = await setup();
    const key = `in/${ulid()}.jpg`;
    await (h.env.BUCKET as R2Bucket).put(key, bytes);
    h.kv.store.set(`upload:${key}`, await hashIdentity(`visitor:${owner}`, HMAC_KEY));
    const visitorHash = await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY);
    return checkUpload(h.env as unknown as Bindings, key, visitorHash);
  }

  it("accepts a JPEG within the limits", async () => {
    expect(await uploaded(jpeg(2048, 1536))).toEqual({ ok: true, width: 2048, height: 1536 });
  });

  it("refuses another browser's upload", async () => {
    expect(await uploaded(jpeg(2048, 1536), "ffffffffffffffffffffffffffffffff")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
  });

  it("refuses non-JPEG bytes, tiny photos and huge photos", async () => {
    expect(await uploaded(new Uint8Array([1, 2, 3, 4]))).toMatchObject({
      code: "FILE_UNSUPPORTED",
    });
    expect(await uploaded(jpeg(2048, 60))).toMatchObject({ code: "FILE_UNSUPPORTED" });
    expect(await uploaded(jpeg(10_000, 6_000))).toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("refuses files over 20MB", async () => {
    const big = new Uint8Array(20_000_001);
    big.set(jpeg(2048, 1536));
    expect(await uploaded(big)).toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("refuses a key that was never uploaded", async () => {
    const h = await setup();
    const visitorHash = await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY);
    h.kv.store.set("upload:in/X.jpg", visitorHash);
    expect(await checkUpload(h.env as unknown as Bindings, "in/X.jpg", visitorHash)).toMatchObject({
      code: "FILE_UNSUPPORTED",
    });
  });
});

describe("POST /v1/uploads", () => {
  it("issues a presigned PUT for a new in/ key owned by this browser", async () => {
    const h = await setup();
    await h.pass();
    const response = await h.call("/v1/uploads", {
      method: "POST",
      body: { contentType: "image/jpeg", bytes: 1_234_567 },
    });
    expect(response.status).toBe(201);
    const key = response.body.key as string;
    expect(UploadKeySchema.safeParse(key).success).toBe(true);
    expect(response.body).toMatchObject({
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      expiresInSec: 600,
    });
    expect(new URL(response.body.url as string).pathname).toBe(`/vzc-test/${key}`);
    expect(h.kv.store.get(`upload:${key}`)).toBe(
      await hashIdentity(`visitor:${VISITOR}`, HMAC_KEY),
    );
  });

  // Final review: the URL must only accept the size and type the browser declared.
  it("signs the declared size and content type into the upload URL", async () => {
    const h = await setup();
    await h.pass();
    const signed = async (bytes: number) => {
      const response = await h.call("/v1/uploads", {
        method: "POST",
        body: { contentType: "image/jpeg", bytes },
      });
      return new URL(response.body.url as string).searchParams;
    };
    const small = await signed(1_000);
    expect(small.get("X-Amz-SignedHeaders")).toBe("content-length;content-type;host");
    expect(small.get("X-Amz-Signature")).not.toBe((await signed(2_000)).get("X-Amz-Signature"));
  });

  it("refuses files over the size limit before issuing a URL", async () => {
    const h = await setup();
    await h.pass();
    const response = await h.call("/v1/uploads", {
      method: "POST",
      body: { contentType: "image/jpeg", bytes: 20_000_001 },
    });
    expect(response.body.error?.code).toBe("FILE_TOO_LARGE");
  });

  it("rejects other content types and needs a human pass", async () => {
    const h = await setup();
    const noPass = await h.call("/v1/uploads", {
      method: "POST",
      body: { contentType: "image/jpeg", bytes: 10 },
    });
    expect(noPass.body.error?.code).toBe("CHALLENGE_REQUIRED");
    await h.pass();
    const png = await h.call("/v1/uploads", {
      method: "POST",
      body: { contentType: "image/png", bytes: 10 },
    });
    expect(png.body.error?.code).toBe("BAD_REQUEST");
  });
});
