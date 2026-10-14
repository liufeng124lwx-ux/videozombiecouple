import { describe, expect, it } from "vitest";
import { MODE_IDS, MODES, PROMPT_VERSION, TIER_IDS, TIERS } from "../src/index.ts";

describe("tiers", () => {
  it("charges 1 / 3 / 6 credits for std / pro / 4k", () => {
    expect(TIER_IDS.map((id) => TIERS[id].credits)).toEqual([1, 3, 6]);
  });

  it("outputs 2048 on the long edge, 4096 for 4K", () => {
    expect(TIERS.std.longEdge).toBe(2048);
    expect(TIERS.pro.longEdge).toBe(2048);
    expect(TIERS["4k"].longEdge).toBe(4096);
  });
});

describe("modes", () => {
  it("has the six modes from spec 3.4 in display order", () => {
    expect(MODE_IDS).toEqual(["auto", "motion", "focus", "portrait", "text", "old"]);
  });

  it("gives every mode a versioned prompt that keeps the photo unchanged", () => {
    for (const id of MODE_IDS) {
      const mode = MODES[id];
      expect(mode.id).toBe(id);
      expect(mode.promptVersion).toBe(PROMPT_VERSION);
      expect(mode.prompt).toContain("Keep everything else exactly the same");
    }
  });

  it("tells the model not to change characters in Text mode", () => {
    expect(MODES.text.prompt).toContain("do not change any characters");
  });

  it("tells the model not to colorize in Old photo mode", () => {
    expect(MODES.old.prompt).toContain("do not colorize");
  });
});
