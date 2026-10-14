import { describe, expect, it } from "vitest";
import { REFINE, TIERS } from "../src/index.ts";

describe("REFINE (spec 3.5, 3.7)", () => {
  it("keeps the brush default inside its range", () => {
    expect(REFINE.brushMin).toBeLessThan(REFINE.brushDefault);
    expect(REFINE.brushDefault).toBeLessThan(REFINE.brushMax);
    expect(REFINE.brushSoftnessDefault).toBeGreaterThan(0);
    expect(REFINE.brushSoftnessDefault).toBeLessThan(1);
  });

  it("caps display textures at the tier sizes and keeps the spec's version and tile limits", () => {
    expect(REFINE.textureLongEdgePhone).toBe(TIERS.std.longEdge);
    expect(REFINE.textureLongEdgeDesktop).toBe(TIERS["4k"].longEdge);
    expect(REFINE.versionsMax).toBe(20);
    expect(REFINE.exportTile).toBe(1024);
  });
});
