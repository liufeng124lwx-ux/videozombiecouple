import { FILE_LIMITS } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { jpegSize } from "./jpeg.ts";

export type UploadCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; code: "FILE_UNSUPPORTED" | "FILE_TOO_LARGE" | "FORBIDDEN" };

/** The browser re-encodes to JPEG without EXIF (spec 3.1), so the frame header is near the start. */
const HEADER_BYTES = 65_536;

/** Spec 3.2 / 7.2: only the browser that asked for the upload URL may use it; check real bytes. */
export async function checkUpload(
  env: Bindings,
  key: string,
  visitorHash: string,
): Promise<UploadCheck> {
  if ((await env.KV.get(`upload:${key}`)) !== visitorHash) return { ok: false, code: "FORBIDDEN" };
  const head = await env.BUCKET.head(key);
  if (!head) return { ok: false, code: "FILE_UNSUPPORTED" };
  if (head.size > FILE_LIMITS.maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };
  const object = await env.BUCKET.get(key, { range: { offset: 0, length: HEADER_BYTES } });
  if (!object) return { ok: false, code: "FILE_UNSUPPORTED" };
  const size = jpegSize(new Uint8Array(await object.arrayBuffer()));
  if (!size) return { ok: false, code: "FILE_UNSUPPORTED" };
  if (size.width * size.height > FILE_LIMITS.maxMegapixels * 1_000_000)
    return { ok: false, code: "FILE_TOO_LARGE" };
  if (Math.min(size.width, size.height) < FILE_LIMITS.minShortEdge)
    return { ok: false, code: "FILE_UNSUPPORTED" };
  return { ok: true, ...size };
}
