import { describe, expect, it } from "vitest";
import {
  boxBlur,
  createRaster,
  crop,
  fitLongEdge,
  flattenOnWhite,
  hasAlpha,
  padExtend,
  type Raster,
  resize,
  rotate,
  toGray,
} from "./raster.ts";

/** A raster from rows of [r, g, b, a] pixels. */
function raster(rows: number[][][]): Raster {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  return { width, height, data: new Uint8ClampedArray(rows.flat(2)) };
}
const px = (r: Raster, x: number, y: number) => [
  ...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4),
];
const A = [255, 0, 0, 255];
const B = [0, 0, 255, 255];

describe("raster", () => {
  it("rotates clockwise by quarter turns", () => {
    const pair = raster([[A, B]]);
    const once = rotate(pair, 1);
    expect([once.width, once.height]).toEqual([1, 2]);
    expect([px(once, 0, 0), px(once, 0, 1)]).toEqual([A, B]);
    expect(px(rotate(pair, 2), 0, 0)).toEqual(B);
    expect(px(rotate(pair, 3), 0, 0)).toEqual(B);
    expect(rotate(pair, 0)).toBe(pair);
  });

  it("puts transparent pixels on white and says so", () => {
    const clear = raster([
      [
        [0, 0, 0, 0],
        [0, 0, 0, 128],
      ],
    ]);
    const { raster: flat, hadAlpha } = flattenOnWhite(clear);
    expect(hadAlpha).toBe(true);
    expect(px(flat, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(px(flat, 1, 0)).toEqual([127, 127, 127, 255]);
    const opaque = raster([[A]]);
    expect(flattenOnWhite(opaque)).toEqual({ raster: opaque, hadAlpha: false });
  });

  it("averages blocks when shrinking and keeps flat colors when enlarging", () => {
    const blocks = raster([
      [A, A, B, B],
      [A, A, B, B],
    ]);
    const small = resize(blocks, 2, 1);
    expect([px(small, 0, 0), px(small, 1, 0)]).toEqual([A, B]);
    const big = resize(raster([[A]]), 3, 2);
    expect([big.width, big.height, ...px(big, 2, 1)]).toEqual([3, 2, ...A]);
  });

  it("only ever shrinks to the long edge", () => {
    expect(fitLongEdge(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitLongEdge(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it("crops a rectangle", () => {
    const strip = raster([[A, B, A]]);
    const middle = crop(strip, { x: 1, y: 0, width: 1, height: 1 });
    expect([middle.width, ...px(middle, 0, 0)]).toEqual([1, ...B]);
  });

  it("extends edge pixels into the padding and leaves the photo untouched", () => {
    const photo = raster([
      [A, B],
      [A, B],
    ]);
    const exact = padExtend(photo, 4, 2, 1, 0, 0);
    expect([px(exact, 0, 0), px(exact, 1, 0), px(exact, 2, 0), px(exact, 3, 0)]).toEqual([
      A,
      A,
      B,
      B,
    ]);
    const blurred = padExtend(photo, 4, 2, 1, 0, 1);
    expect([px(blurred, 1, 0), px(blurred, 2, 1)]).toEqual([A, B]);
  });

  it("blurs with a box and reads luminance", () => {
    const edge = raster([
      [
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [0, 0, 0, 255],
      ],
    ]);
    expect(px(boxBlur(edge, 1), 1, 0)).toEqual([85, 85, 85, 255]);
    expect(createRaster(2, 3).data.length).toBe(24);
    expect([...toGray(raster([[[255, 255, 255, 255]]]))]).toEqual([255]);
  });

  it("tells whether any pixel is transparent without copying", () => {
    expect(hasAlpha(raster([[A, [0, 0, 0, 10]]]))).toBe(true);
    expect(hasAlpha(raster([[A, B]]))).toBe(false);
  });
});
