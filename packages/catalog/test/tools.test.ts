import { describe, expect, it } from "vitest";
import {
  ENCODER_QUALITY,
  FILE_LIMITS,
  fact,
  IMAGE_TOOL_IDS,
  IMAGE_TOOLS,
  LOCAL_LIMITS,
  LOCAL_OP_IDS,
  LOCAL_OPS,
  PAGES,
  PNG_COLORS,
} from "../src/index.ts";

describe("local image tools (local tools spec 1)", () => {
  it("give every operation one line for the Agent", () => {
    for (const id of LOCAL_OP_IDS) expect(LOCAL_OPS[id].agent.length).toBeGreaterThan(20);
  });

  it("point every tool at an operation; compress tools keep the smaller file, the rest never do", () => {
    for (const id of IMAGE_TOOL_IDS) {
      const tool = IMAGE_TOOLS[id];
      expect(LOCAL_OP_IDS).toContain(tool.op);
      expect(tool.output.keepSmaller).toBe(tool.op === "compress");
    }
  });

  it("convert to the format the page name promises", () => {
    for (const id of IMAGE_TOOL_IDS.filter((t) => t.endsWith("-to-jpg")))
      expect(IMAGE_TOOLS[id].output.format).toBe("jpeg");
    expect(IMAGE_TOOLS["jpg-to-png"].output.format).toBe("png");
    expect(IMAGE_TOOLS["compress-png"].output.format).toBe("png");
    expect(IMAGE_TOOLS["compress-jpeg"].output.format).toBe("jpeg");
  });

  it("rank the quality levels high > balanced > small inside the search bounds", () => {
    for (const levels of Object.values(ENCODER_QUALITY)) {
      expect(levels.high).toBeGreaterThan(levels.balanced);
      expect(levels.balanced).toBeGreaterThan(levels.small);
      expect(levels.small).toBeGreaterThanOrEqual(LOCAL_LIMITS.minQuality);
      expect(levels.high).toBeLessThanOrEqual(LOCAL_LIMITS.maxQuality);
    }
  });

  it("keep PNG lossless at High and within 256 colors otherwise", () => {
    expect(PNG_COLORS.high).toBe(0);
    expect(PNG_COLORS.balanced).toBeLessThanOrEqual(256);
    expect(PNG_COLORS.small).toBeLessThan(PNG_COLORS.balanced);
  });

  it("offer target sizes inside the custom range and share the upload limits", () => {
    for (const kb of LOCAL_LIMITS.targetsKb) {
      expect(kb).toBeGreaterThanOrEqual(LOCAL_LIMITS.minTargetKb);
      expect(kb).toBeLessThanOrEqual(LOCAL_LIMITS.maxTargetKb);
    }
    expect(LOCAL_LIMITS.maxBytes).toBe(FILE_LIMITS.maxBytes);
    expect(LOCAL_LIMITS.maxMegapixels).toBe(FILE_LIMITS.maxMegapixels);
  });

  it("give every local-tool page except Compress GIF its own tool, named like the page", () => {
    for (const page of PAGES.filter((p) => p.kind === "local-tool" && p.id !== "compress-gif")) {
      expect(IMAGE_TOOL_IDS).toContain(page.tool);
      expect(page.tool).toBe(page.id);
    }
  });

  it("publish the numbers the pages show", () => {
    expect(fact("local.maxFiles")).toBe("20");
    expect(fact("local.maxMegapixels")).toBe("50");
    expect([fact("local.target1"), fact("local.target2"), fact("local.target3")]).toEqual([
      "100 KB",
      "200 KB",
      "500 KB",
    ]);
  });

  it("start with HEIC to JPG as a draft local-tool page (spec 6)", () => {
    const page = PAGES.find((p) => p.id === "heic-to-jpg");
    expect(page).toMatchObject({ kind: "local-tool", tool: "heic-to-jpg" });
    expect(page?.locales.en).toMatchObject({
      slug: "heic-to-jpg",
      h1: "HEIC to JPG",
      status: "draft",
    });
  });
});
