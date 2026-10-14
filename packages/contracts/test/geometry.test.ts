import { SEEDREAM_ASPECTS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import {
  cropRect,
  fitsAfterPad,
  intersectAspects,
  nearestAspect,
  padToAspect,
  parseAspect,
} from "../src/index.ts";

describe("aspects", () => {
  it("parse w:h strings", () => {
    expect(parseAspect("4:3")).toBeCloseTo(4 / 3);
    expect(() => parseAspect("4x3")).toThrow();
    expect(() => parseAspect("0:3")).toThrow();
  });

  it("pick the nearest allowed ratio on a log scale", () => {
    expect(nearestAspect(4032, 3024, SEEDREAM_ASPECTS)).toBe("4:3");
    expect(nearestAspect(1080, 1920, SEEDREAM_ASPECTS)).toBe("9:16");
    expect(nearestAspect(1000, 1000, SEEDREAM_ASPECTS)).toBe("1:1");
    expect(nearestAspect(6000, 500, SEEDREAM_ASPECTS)).toBe("21:9");
  });

  it("intersect lists keeping the first list's order", () => {
    expect(
      intersectAspects([
        ["1:1", "4:3", "21:9"],
        ["4:3", "1:1", "5:4"],
      ]),
    ).toEqual(["1:1", "4:3"]);
    expect(intersectAspects([])).toEqual([]);
  });
});

describe("padding and cropping (spec 3.1)", () => {
  it("pads the short side and centres the photo", () => {
    const padded = padToAspect(1000, 1000, "4:3");
    expect(padded).toMatchObject({ width: 1333, height: 1000, aspect: "4:3" });
    expect(padded.cropBox.x).toBeCloseTo(166 / 1333, 6);
    expect(padded.cropBox.y).toBe(0);
    expect(padded.cropBox.w).toBeCloseTo(1000 / 1333, 6);
    expect(padded.cropBox.h).toBe(1);
  });

  it("does not pad a photo that already has the ratio", () => {
    expect(padToAspect(4000, 3000, "4:3")).toEqual({
      width: 4000,
      height: 3000,
      aspect: "4:3",
      cropBox: { x: 0, y: 0, w: 1, h: 1 },
    });
  });

  it("never makes the canvas smaller than the photo", () => {
    for (const [w, h] of [
      [1001, 997],
      [333, 1000],
      [1920, 1081],
    ] as const) {
      const padded = padToAspect(w, h, nearestAspect(w, h, SEEDREAM_ASPECTS));
      expect(padded.width).toBeGreaterThanOrEqual(w);
      expect(padded.height).toBeGreaterThanOrEqual(h);
    }
  });

  it("crops a model output of a different size back to the photo", () => {
    const { cropBox } = padToAspect(1000, 1000, "4:3");
    // The model returned 2048×1536 for the 1333×1000 canvas.
    expect(cropRect(2048, 1536, cropBox)).toEqual({ x: 255, y: 0, width: 1536, height: 1536 });
  });

  it("clamps the crop to the output", () => {
    expect(cropRect(100, 100, { x: 0.9, y: 0.9, w: 0.2, h: 0.2 })).toEqual({
      x: 90,
      y: 90,
      width: 10,
      height: 10,
    });
  });

  // Review focus 1: extreme panoramas end up as a sliver after padding and scaling.
  it("reports when the photo would shrink below the minimum short edge", () => {
    expect(fitsAfterPad(4032, 3024, "4:3", 2048)).toBe(true);
    expect(fitsAfterPad(6000, 500, "21:9", 2048)).toBe(true); // 2048 × 171
    expect(fitsAfterPad(20000, 300, "21:9", 2048)).toBe(false); // 2048 × 31
  });
});
