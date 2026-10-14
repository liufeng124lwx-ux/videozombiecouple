import { FILE_LIMITS } from "@vzc/catalog";
import { decodeImage, encodeImage } from "../image/codec.ts";
import { fitLongEdge, type Raster, resize } from "../image/raster.ts";
import { detectFaces } from "./face-detector.ts";
import { type FaceBox, type FaceVerdict, faceVerdict } from "./faces.ts";

/** Uploads are at most this long on their long edge: plenty for a face, small to send. */
export const UPLOAD_LONG_EDGE = 2048;
const JPEG_QUALITY = 0.92;
/** Face detection runs on a copy this long on its long edge. */
const DETECT_LONG_EDGE = 640;

export type PrepareDeps = {
  decode: (blob: Blob) => Promise<Raster>;
  detect: (raster: Raster) => Promise<FaceBox[] | null>;
  encode: (raster: Raster) => Promise<Blob>;
};

export const browserDeps: PrepareDeps = {
  decode: decodeImage,
  detect: (r) => {
    const size = fitLongEdge(r.width, r.height, DETECT_LONG_EDGE);
    return detectFaces(resize(r, size.width, size.height));
  },
  encode: (r) => encodeImage(r, "image/jpeg", JPEG_QUALITY),
};

export type Prepared =
  | { ok: true; jpeg: Blob; width: number; height: number; face: FaceVerdict | "skipped" }
  | { ok: false; code: "FILE_UNSUPPORTED" | "FILE_TOO_LARGE" };

/**
 * Spec §4.2 S0: decode (EXIF orientation applied), check the face, re-encode as JPEG. The new JPEG
 * carries no EXIF or GPS. `check` is "pet" for the pet photo, which has no human face to find.
 */
export async function preparePhoto(
  file: Blob,
  check: "face" | "pet",
  deps: PrepareDeps = browserDeps,
): Promise<Prepared> {
  if (file.size > FILE_LIMITS.maxBytes) return { ok: false, code: "FILE_TOO_LARGE" };
  let raster: Raster;
  try {
    raster = await deps.decode(file);
  } catch {
    return { ok: false, code: "FILE_UNSUPPORTED" };
  }
  if (Math.min(raster.width, raster.height) < FILE_LIMITS.minShortEdge)
    return { ok: false, code: "FILE_UNSUPPORTED" };
  const face =
    check === "pet"
      ? "skipped"
      : faceVerdict(await deps.detect(raster), raster.width, raster.height);
  const size = fitLongEdge(raster.width, raster.height, UPLOAD_LONG_EDGE);
  const sized = size.width === raster.width ? raster : resize(raster, size.width, size.height);
  const jpeg = await deps.encode(sized);
  return { ok: true, jpeg, width: sized.width, height: sized.height, face };
}
