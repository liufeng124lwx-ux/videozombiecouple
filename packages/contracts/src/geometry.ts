import { FILE_LIMITS } from "@vzc/catalog";

/** The photo's place inside the padded canvas, as fractions of the canvas (spec 3.1). */
export type CropBox = { x: number; y: number; w: number; h: number };

export function parseAspect(aspect: string): number {
  const match = /^(\d+):(\d+)$/.exec(aspect);
  const w = Number(match?.[1]);
  const h = Number(match?.[2]);
  if (!match || w <= 0 || h <= 0) throw new Error(`invalid aspect ratio "${aspect}"`);
  return w / h;
}

export function nearestAspect(width: number, height: number, allowed: readonly string[]): string {
  if (allowed.length === 0) throw new Error("no aspect ratios allowed");
  const ratio = width / height;
  let best = allowed[0] as string;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const aspect of allowed) {
    const distance = Math.abs(Math.log(parseAspect(aspect) / ratio));
    if (distance < bestDistance) {
      best = aspect;
      bestDistance = distance;
    }
  }
  return best;
}

export function intersectAspects(lists: readonly (readonly string[])[]): string[] {
  const [first, ...rest] = lists;
  if (!first) return [];
  return first.filter((aspect) => rest.every((list) => list.includes(aspect)));
}

export type Padded = { width: number; height: number; aspect: string; cropBox: CropBox };

/** Smallest canvas with the target ratio that contains the photo, photo centred. */
export function padToAspect(width: number, height: number, aspect: string): Padded {
  const ratio = parseAspect(aspect);
  let canvasWidth = width;
  let canvasHeight = height;
  if (width / height > ratio) canvasHeight = Math.max(height, Math.round(width / ratio));
  else canvasWidth = Math.max(width, Math.round(height * ratio));
  const x = Math.floor((canvasWidth - width) / 2);
  const y = Math.floor((canvasHeight - height) / 2);
  return {
    width: canvasWidth,
    height: canvasHeight,
    aspect,
    cropBox: {
      x: x / canvasWidth,
      y: y / canvasHeight,
      w: width / canvasWidth,
      h: height / canvasHeight,
    },
  };
}

/** Pixel rectangle of the photo inside a model output of any size, clamped to the output. */
export function cropRect(
  outputWidth: number,
  outputHeight: number,
  box: CropBox,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(outputWidth, Math.max(0, Math.round(box.x * outputWidth)));
  const y = Math.min(outputHeight, Math.max(0, Math.round(box.y * outputHeight)));
  const width = Math.min(outputWidth - x, Math.round(box.w * outputWidth));
  const height = Math.min(outputHeight - y, Math.round(box.h * outputHeight));
  return { x, y, width, height };
}

/** Whether the photo keeps a usable short edge once padded and scaled to the tier's long edge. */
export function fitsAfterPad(
  width: number,
  height: number,
  aspect: string,
  longEdge: number,
  minShortEdge: number = FILE_LIMITS.minShortEdge,
): boolean {
  const padded = padToAspect(width, height, aspect);
  const scale = Math.min(1, longEdge / Math.max(padded.width, padded.height));
  return Math.min(width, height) * scale >= minShortEdge;
}
