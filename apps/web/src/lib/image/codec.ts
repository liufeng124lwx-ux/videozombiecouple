import { FILE_LIMITS } from "@vzc/catalog";
import { fitLongEdge, type Raster } from "./raster.ts";

/** Work on at most this many pixels on the long edge (enough for a face; keeps memory low). */
export const WORKING_LONG_EDGE = 2048;
const workingSize = (w: number, h: number) => fitLongEdge(w, h, WORKING_LONG_EDGE);

function canvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element;
}

function context(target: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = target.getContext("2d", { willReadFrequently: true }) as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("FILE_UNSUPPORTED");
  return ctx;
}

/** Decode and apply the EXIF orientation. Throws FILE_UNSUPPORTED if it can't. */
export async function decodeImage(blob: Blob): Promise<Raster> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    // HEIC and broken files: browsers other than Safari cannot open HEIC; ask for a JPG.
    throw new Error("FILE_UNSUPPORTED");
  }
  // Refuse huge photos before reading their pixels; work on at most WORKING_LONG_EDGE px.
  if (bitmap.width * bitmap.height > FILE_LIMITS.maxMegapixels * 1_000_000) {
    bitmap.close();
    throw new Error("FILE_UNSUPPORTED");
  }
  const size = workingSize(bitmap.width, bitmap.height);
  const target = canvas(size.width, size.height);
  const ctx = context(target);
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const image = ctx.getImageData(0, 0, target.width, target.height);
  return { width: image.width, height: image.height, data: image.data };
}

export type ImageType = "image/png" | "image/jpeg" | "image/webp";

/** JPEG quality 0.92 for uploads (spec 3.1); WEBP 0.95 elsewhere; PNG is lossless. */
export async function encodeImage(r: Raster, type: ImageType, quality?: number): Promise<Blob> {
  const target = canvas(r.width, r.height);
  // A fresh copy is backed by a plain ArrayBuffer, which ImageData requires.
  context(target).putImageData(
    new ImageData(new Uint8ClampedArray(r.data), r.width, r.height),
    0,
    0,
  );
  const options = quality === undefined ? { type } : { type, quality };
  if (target instanceof OffscreenCanvas) return target.convertToBlob(options);
  return new Promise<Blob>((resolve, reject) =>
    target.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encode failed"))),
      type,
      quality,
    ),
  );
}

/** Results live on R2 behind signed links; the bucket allows our origin (CORS, plan 7). */
export async function fetchRaster(url: string): Promise<Raster> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`fetch ${response.status}`);
  return decodeImage(await response.blob());
}

/** An object URL for showing a raster in an <img>. */
export async function rasterUrl(r: Raster): Promise<string> {
  return URL.createObjectURL(await encodeImage(r, "image/jpeg", 0.92));
}
