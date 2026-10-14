/** RGBA pixels, row by row. Everything here is plain math, so it runs in Workers and in tests. */
export type Raster = { width: number; height: number; data: Uint8ClampedArray };

export function createRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Clockwise quarter turns. */
export function rotate(src: Raster, turns: 0 | 1 | 2 | 3): Raster {
  if (turns === 0) return src;
  const { width: w, height: h, data } = src;
  const out = turns === 2 ? createRaster(w, h) : createRaster(h, w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = turns === 1 ? h - 1 - y : turns === 2 ? w - 1 - x : y;
      const ny = turns === 1 ? x : turns === 2 ? h - 1 - y : w - 1 - x;
      const from = (y * w + x) * 4;
      out.data.set(data.subarray(from, from + 4), (ny * out.width + nx) * 4);
    }
  }
  return out;
}

/** Whether any pixel is see-through; reads only, no copy. */
export function hasAlpha(src: Raster): boolean {
  for (let i = 3; i < src.data.length; i += 4) if ((src.data[i] ?? 255) < 255) return true;
  return false;
}

/** Spec 3.1 step 4: transparent photos go on white (P0); the caller tells the user. */
export function flattenOnWhite(src: Raster): { raster: Raster; hadAlpha: boolean } {
  const hadAlpha = hasAlpha(src);
  if (!hadAlpha) return { raster: src, hadAlpha };
  const out = createRaster(src.width, src.height);
  for (let i = 0; i < src.data.length; i += 4) {
    const alpha = (src.data[i + 3] ?? 255) / 255;
    for (let c = 0; c < 3; c++)
      out.data[i + c] = Math.round((src.data[i + c] ?? 0) * alpha + 255 * (1 - alpha));
    out.data[i + 3] = 255;
  }
  return { raster: out, hadAlpha };
}

export function fitLongEdge(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function shrinkArea(src: Raster, width: number, height: number): Raster {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  const sum = [0, 0, 0, 0];
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      sum.fill(0);
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          for (let c = 0; c < 4; c++) sum[c] = (sum[c] ?? 0) + (src.data[i + c] ?? 0);
          n++;
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = (sum[c] ?? 0) / n;
    }
  }
  return out;
}

function bilinear(src: Raster, width: number, height: number): Raster {
  const out = createRaster(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const at = (xx: number, yy: number) => src.data[(yy * src.width + xx) * 4 + c] ?? 0;
        const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
        const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
        out.data[o + c] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return out;
}

/** Area average when shrinking (no aliasing), bilinear when either side grows. */
export function resize(src: Raster, width: number, height: number): Raster {
  if (width === src.width && height === src.height) return src;
  return width <= src.width && height <= src.height
    ? shrinkArea(src, width, height)
    : bilinear(src, width, height);
}

export function crop(
  src: Raster,
  rect: { x: number; y: number; width: number; height: number },
): Raster {
  const out = createRaster(rect.width, rect.height);
  for (let y = 0; y < rect.height; y++) {
    const from = ((rect.y + y) * src.width + rect.x) * 4;
    out.data.set(src.data.subarray(from, from + rect.width * 4), y * rect.width * 4);
  }
  return out;
}

/** Separable box blur over all four channels, clamping at the edges. */
export function boxBlur(src: Raster, radius: number): Raster {
  if (radius <= 0) return src;
  const pass = (from: Raster, horizontal: boolean): Raster => {
    const out = createRaster(from.width, from.height);
    const lines = horizontal ? from.height : from.width;
    const length = horizontal ? from.width : from.height;
    const index = (line: number, k: number) =>
      ((horizontal ? line * from.width + k : k * from.width + line) * 4) as number;
    const span = radius * 2 + 1;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        for (let k = -radius; k <= radius; k++)
          acc += from.data[index(line, Math.min(length - 1, Math.max(0, k))) + c] ?? 0;
        for (let k = 0; k < length; k++) {
          out.data[index(line, k) + c] = acc / span;
          const leaving = Math.max(0, k - radius);
          const entering = Math.min(length - 1, k + radius + 1);
          acc +=
            (from.data[index(line, entering) + c] ?? 0) -
            (from.data[index(line, leaving) + c] ?? 0);
        }
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/**
 * Spec 3.1 step 6: the padding repeats the photo's edge pixels and is then blurred, so the model
 * sees a calm frame; the photo itself is copied back untouched.
 */
export function padExtend(
  photo: Raster,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  blurRadius: number,
): Raster {
  const extended = createRaster(canvasWidth, canvasHeight);
  for (let cy = 0; cy < canvasHeight; cy++) {
    const sy = Math.min(photo.height - 1, Math.max(0, cy - y));
    for (let cx = 0; cx < canvasWidth; cx++) {
      const sx = Math.min(photo.width - 1, Math.max(0, cx - x));
      const from = (sy * photo.width + sx) * 4;
      extended.data.set(photo.data.subarray(from, from + 4), (cy * canvasWidth + cx) * 4);
    }
  }
  if (blurRadius <= 0) return extended;
  const blurred = boxBlur(extended, blurRadius);
  for (let row = 0; row < photo.height; row++) {
    const from = row * photo.width * 4;
    blurred.data.set(
      photo.data.subarray(from, from + photo.width * 4),
      ((y + row) * canvasWidth + x) * 4,
    );
  }
  return blurred;
}

export function toGray(src: Raster): Float32Array {
  const gray = new Float32Array(src.width * src.height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++)
    gray[j] =
      0.299 * (src.data[i] ?? 0) + 0.587 * (src.data[i + 1] ?? 0) + 0.114 * (src.data[i + 2] ?? 0);
  return gray;
}
