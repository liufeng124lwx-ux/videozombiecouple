/** A face as shares of the image. */
export type FaceBox = { x: number; y: number; w: number; h: number };
/** What MediaPipe returns, reduced to what we use; the box is in pixels. */
export type RawDetection = {
  score: number;
  box: { originX: number; originY: number; width: number; height: number };
};

/** MediaPipe detections below this confidence are ignored. */
export const FACE_MIN_CONFIDENCE = 0.5;
/** A face smaller than this share of the photo's short edge is too small to keep its identity. */
export const FACE_MIN_SHARE = 0.12;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Confident detections as boxes inside the image, largest first. */
export function toFaceBoxes(
  detections: readonly RawDetection[],
  width: number,
  height: number,
): FaceBox[] {
  const boxes: FaceBox[] = [];
  for (const d of detections) {
    if (d.score < FACE_MIN_CONFIDENCE) continue;
    const left = clamp(d.box.originX, 0, width);
    const top = clamp(d.box.originY, 0, height);
    const right = clamp(d.box.originX + d.box.width, 0, width);
    const bottom = clamp(d.box.originY + d.box.height, 0, height);
    if (right <= left || bottom <= top) continue;
    boxes.push({
      x: left / width,
      y: top / height,
      w: (right - left) / width,
      h: (bottom - top) / height,
    });
  }
  return boxes.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 20);
}

export type FaceVerdict = "ok" | "none" | "many" | "small" | "unknown";

/**
 * Spec §4.2 S0: one clear face per photo. `null` means the detector could not run: let it through,
 * the server checks again.
 */
export function faceVerdict(
  faces: readonly FaceBox[] | null,
  width: number,
  height: number,
): FaceVerdict {
  if (faces === null) return "unknown";
  if (faces.length === 0) return "none";
  const [first, second] = faces as [FaceBox, FaceBox | undefined];
  // A second face at least half the size of the first is another person, not a poster on the wall.
  if (second && second.w * second.h >= 0.5 * first.w * first.h) return "many";
  const shortEdge = Math.min(width, height);
  const faceEdge = Math.max(first.w * width, first.h * height);
  return faceEdge / shortEdge < FACE_MIN_SHARE ? "small" : "ok";
}
