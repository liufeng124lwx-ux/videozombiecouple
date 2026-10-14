import { FILE_LIMITS } from "./limits.ts";

/** Local tools spec 1.1: what a browser tool can do. `agent` is the line the Agent reads (sub-project 2). */
export const LOCAL_OP_IDS = [
  "compress",
  "convert",
  "resize",
  "crop",
  "flip",
  "rotate",
  "strip-metadata",
  "blur-faces",
] as const;
export type LocalOpId = (typeof LOCAL_OP_IDS)[number];

export const LOCAL_OPS: Record<LocalOpId, { agent: string }> = {
  compress: {
    agent:
      "Make the file smaller in the browser, by quality level or to a target size in KB. Free.",
  },
  convert: { agent: "Save the image as JPEG, PNG, WebP or AVIF in the browser. Free." },
  resize: {
    agent: "Change the width and height, or scale by a percent, keeping proportions. Free.",
  },
  crop: { agent: "Cut the image to a box or to an aspect ratio such as 1:1 or 16:9. Free." },
  flip: { agent: "Mirror the image horizontally or vertically. Free." },
  rotate: { agent: "Turn the image by 90, 180 or 270 degrees clockwise. Free." },
  "strip-metadata": {
    agent: "Remove EXIF, GPS location and camera details without re-encoding the pixels. Free.",
  },
  "blur-faces": { agent: "Blur or pixelate the faces inside the given boxes. Free." },
};

export const OUT_FORMATS = ["jpeg", "png", "webp", "avif"] as const;
export type OutFormat = (typeof OUT_FORMATS)[number];
/** What the engine reads; GIF and APNG give their first frame (spec 2.2). */
export const IN_FORMATS = ["jpeg", "png", "webp", "avif", "heic", "gif", "bmp"] as const;
export type InFormat = (typeof IN_FORMATS)[number];

export const QUALITY_IDS = ["high", "balanced", "small"] as const;
export type QualityId = (typeof QUALITY_IDS)[number];

/** A rectangle as shares of the image (0–1), from the top-left corner. */
export type Box = { x: number; y: number; w: number; h: number };

export type LocalStep =
  | { op: "resize"; width?: number; height?: number; scale?: number }
  | { op: "crop"; box?: Box; ratio?: readonly [number, number] }
  | { op: "flip"; axis: "h" | "v" }
  | { op: "rotate"; turns: 1 | 2 | 3 }
  | { op: "blur-faces"; style: "blur" | "pixelate"; strength: number; boxes: readonly Box[] };

export type LocalOutput = {
  /** keep = the input's own format where we can write it; auto = PNG for graphics, JPEG for photos. */
  format: OutFormat | "keep" | "auto";
  quality: QualityId;
  /** JPEG and WebP only (spec 2.5). */
  targetKb?: number;
  /** Compress pages hand back the original when the result is not smaller (spec 2.5). */
  keepSmaller: boolean;
};

/** Spec 1.3: the one shape pages and the Agent hand to the engine. */
export type LocalPipeline =
  | { kind: "edit"; steps: readonly LocalStep[]; output: LocalOutput }
  | { kind: "strip" };

/** Spec 2.5: encoder quality (0–100) per level; recalibrate on the eval photos if a size test fails. */
export const ENCODER_QUALITY: Record<"jpeg" | "webp" | "avif", Record<QualityId, number>> = {
  jpeg: { high: 85, balanced: 75, small: 60 },
  webp: { high: 85, balanced: 75, small: 60 },
  avif: { high: 70, balanced: 55, small: 40 },
};

/** Spec 2.5: palette size for graphics and screenshots; 0 = lossless. */
export const PNG_COLORS: Record<QualityId, number> = { high: 0, balanced: 256, small: 128 };

/** Crop presets, width:height. */
export const CROP_RATIOS: readonly (readonly [number, number])[] = [
  [1, 1],
  [4, 3],
  [3, 2],
  [16, 9],
  [9, 16],
  [4, 5],
];

/** Spec 1.2 / 2.1 / 2.5. */
export const LOCAL_LIMITS = {
  maxFiles: 20,
  maxBytes: FILE_LIMITS.maxBytes,
  maxMegapixels: FILE_LIMITS.maxMegapixels,
  targetsKb: [100, 200, 500],
  minTargetKb: 20,
  maxTargetKb: 10_240,
  /** Encodes per size before the sides shrink. */
  maxEncodes: 7,
  shrinkShare: 0.85,
  maxShrinks: 4,
  minQuality: 10,
  maxQuality: 95,
  /** Up to this many distinct colors in the sample counts as a graphic or screenshot. */
  graphicMaxColors: 20_000,
  sampleMegapixels: 1,
  rerunDelayMs: 400,
  /** Detected face boxes grow by this share on each side, to cover hair and ears. */
  faceMargin: 0.15,
  /** Image Resizer: the percent field runs 1 to this, and a typed side is at most maxSidePx. */
  maxScalePct: 400,
  maxSidePx: 16_384,
} as const;

export const IMAGE_TOOL_IDS = [
  "compress-image",
  "compress-png",
  "compress-jpeg",
  "heic-to-jpg",
  "webp-to-jpg",
  "png-to-jpg",
  "avif-to-jpg",
  "jfif-to-jpg",
  "jpg-to-png",
  "image-resizer",
  "crop-image",
  "flip-image",
  "remove-exif-data",
  "blur-face",
] as const;
export type ImageToolId = (typeof IMAGE_TOOL_IDS)[number];

export type ImageTool = {
  op: LocalOpId;
  output: LocalOutput;
  /** The download is <name>-<suffix>.<ext>; null keeps the name and only changes the extension. */
  suffix: string | null;
};

const out = (
  format: LocalOutput["format"],
  quality: QualityId,
  keepSmaller = false,
): LocalOutput => ({ format, quality, keepSmaller });
const toJpg: ImageTool = { op: "convert", output: out("jpeg", "high"), suffix: null };

/** Spec 1.2: one page = one operation + its defaults. */
export const IMAGE_TOOLS: Record<ImageToolId, ImageTool> = {
  "compress-image": { op: "compress", output: out("auto", "balanced", true), suffix: "compressed" },
  "compress-png": { op: "compress", output: out("png", "balanced", true), suffix: "compressed" },
  "compress-jpeg": { op: "compress", output: out("jpeg", "balanced", true), suffix: "compressed" },
  "heic-to-jpg": toJpg,
  "webp-to-jpg": toJpg,
  "png-to-jpg": toJpg,
  "avif-to-jpg": toJpg,
  "jfif-to-jpg": toJpg,
  "jpg-to-png": { op: "convert", output: out("png", "high"), suffix: null },
  "image-resizer": { op: "resize", output: out("keep", "high"), suffix: "resized" },
  "crop-image": { op: "crop", output: out("keep", "high"), suffix: "cropped" },
  "flip-image": { op: "flip", output: out("keep", "high"), suffix: "flipped" },
  "remove-exif-data": { op: "strip-metadata", output: out("keep", "high"), suffix: "clean" },
  "blur-face": { op: "blur-faces", output: out("keep", "high"), suffix: "blurred" },
};
