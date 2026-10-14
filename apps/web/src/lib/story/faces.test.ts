import { describe, expect, it } from "vitest";
import { faceVerdict, toFaceBoxes } from "./faces.ts";

const box = (x: number, y: number, w: number, h: number, score = 0.9) => ({
  score,
  box: { originX: x, originY: y, width: w, height: h },
});

describe("faces", () => {
  it("keeps confident faces inside the image, largest first", () => {
    const faces = toFaceBoxes(
      [box(10, 10, 50, 50), box(100, 100, 200, 200), box(0, 0, 80, 80, 0.2)],
      400,
      400,
    );
    expect(faces).toHaveLength(2);
    expect(faces[0]).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it("wants exactly one clear face", () => {
    expect(faceVerdict(null, 1000, 1000)).toBe("unknown");
    expect(faceVerdict([], 1000, 1000)).toBe("none");
    const big = { x: 0.3, y: 0.2, w: 0.3, h: 0.3 };
    expect(faceVerdict([big], 1000, 1000)).toBe("ok");
    expect(faceVerdict([big, { x: 0, y: 0, w: 0.25, h: 0.25 }], 1000, 1000)).toBe("many");
    expect(faceVerdict([big, { x: 0, y: 0, w: 0.05, h: 0.05 }], 1000, 1000)).toBe("ok");
    expect(faceVerdict([{ x: 0.5, y: 0.5, w: 0.05, h: 0.05 }], 1000, 1000)).toBe("small");
  });
});
