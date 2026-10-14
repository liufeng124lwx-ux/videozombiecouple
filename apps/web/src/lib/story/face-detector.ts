import type { Raster } from "../image/raster.ts";
import { FACE_MIN_CONFIDENCE, type FaceBox, toFaceBoxes } from "./faces.ts";

/** Self-hosted (spec 3.4): copied by scripts/vendor.ts, and the model in public/models. */
const WASM = "/vendor/mediapipe";
const MODEL = "/models/blaze_face_short_range.tflite";

type Detector = {
  detect(image: ImageData): {
    detections: {
      categories: { score: number }[];
      boundingBox?: { originX: number; originY: number; width: number; height: number };
    }[];
  };
};

let loading: Promise<Detector | null> | null = null;

/** Loads once, in the background; null where it can't run (no wasm, blocked, offline). */
export function loadFaceDetector(): Promise<Detector | null> {
  loading ??= (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      return await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: FACE_MIN_CONFIDENCE,
      });
    } catch {
      return null;
    }
  })();
  return loading;
}

/** Faces in a small copy, as shares; null when detection isn't available. */
export async function detectFaces(r: Raster): Promise<FaceBox[] | null> {
  const detector = await loadFaceDetector();
  if (!detector) return null;
  try {
    const image = new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
    const result = detector.detect(image);
    return toFaceBoxes(
      result.detections.map((d) => ({
        score: d.categories[0]?.score ?? 0,
        box: d.boundingBox ?? { originX: 0, originY: 0, width: 0, height: 0 },
      })),
      r.width,
      r.height,
    );
  } catch {
    return null;
  }
}
