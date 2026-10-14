import type { Raster } from "../lib/image/raster.ts";

/** Fastest of `runs` timings, so one stall from a busy machine doesn't count. */
function fastest(fn: () => void, runs: number): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** One simple pass over every channel; the yardstick for {@link relativeCost}. */
function referencePass(r: Raster): void {
  const d = r.data;
  let acc = 0;
  for (let i = 0; i < d.length; i++) acc += Math.cbrt(d[i] ?? 0);
  if (acc < 0) throw new Error("unreachable");
}

/**
 * How many reference passes over the same raster `work` costs. A ratio holds on a slow or busy
 * machine (CI with two cores, every package testing at once) where a fixed millisecond bound
 * does not (docs/lessons.md §三).
 */
export function relativeCost(r: Raster, work: () => void, runs = 3): number {
  const base = fastest(() => referencePass(r), runs);
  return fastest(work, runs) / base;
}
