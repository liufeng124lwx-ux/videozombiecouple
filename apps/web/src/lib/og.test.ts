// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { ogTree, renderOg } from "./og.ts";

const LABELS = { before: "Standoff", after: "Memory" };
const dir = mkdtempSync(join(tmpdir(), "og-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const frame = (file: string, rgb: { r: number; g: number; b: number }) =>
  sharp({ create: { width: 360, height: 640, channels: 3, background: rgb } })
    .jpeg()
    .toFile(join(dir, file));

describe("share images (spec 2.4, design §10)", () => {
  it("lays out the cold and warm frames next to the page name", () => {
    const json = JSON.stringify(
      ogTree("Zombie Love Story AI", { before: "data:b", after: "data:a" }, LABELS),
    );
    expect(json).toContain("Zombie Love Story AI");
    expect(json).toContain("data:b");
    expect(json).toContain("data:a");
    expect(json).toContain("Memory");
  });

  it("uses a name-only layout for pages without a sample", () => {
    expect(JSON.stringify(ogTree("Pricing", null, LABELS))).not.toContain('"img"');
  });

  it("renders a small 1200×630 JPEG, with or without frames", async () => {
    await frame("a.jpg", { r: 11, g: 15, b: 20 });
    await frame("c.jpg", { r: 240, g: 160, b: 64 });
    for (const sample of [null, { before: "a.jpg", after: "c.jpg" }]) {
      const jpg = await renderOg("Zombie Video Couple", sample, LABELS, dir);
      const meta = await sharp(jpg).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1200, 630]);
      expect(jpg.byteLength).toBeLessThan(200_000);
    }
  }, 30_000);
});
