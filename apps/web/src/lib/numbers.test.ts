import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { handWrittenNumbers } from "./numbers.ts";

describe("hand-written numbers (spec 2.2)", () => {
  it("catches numbers next to product units", () => {
    expect(handWrittenNumbers("You get 3 free previews a day")).toHaveLength(1);
    expect(handWrittenNumbers("A video costs 10 credits")).toHaveLength(1);
    expect(handWrittenNumbers("Buy 3 videos")).toHaveLength(1);
    expect(handWrittenNumbers("A 12-second film")).toHaveLength(0);
    expect(handWrittenNumbers("A 12 second film, 12s long")).toHaveLength(1);
    expect(handWrittenNumbers("Deleted after 24 hours")).toHaveLength(1);
    expect(handWrittenNumbers("Deleted in 24h")).toHaveLength(1);
    expect(handWrittenNumbers("Packs start at $4.99")).toHaveLength(1);
    expect(handWrittenNumbers("Photos up to 20 MB")).toHaveLength(1);
    expect(handWrittenNumbers("Save 20%")).toHaveLength(1);
  });

  it("allows catalog facts, tier names and plain counting", () => {
    expect(handWrittenNumbers('You get <F k="preview.daily" /> free previews a day')).toEqual([]);
    expect(handWrittenNumbers("description: Get {{preview.daily}} free a day")).toEqual([]);
    expect(handWrittenNumbers("Upload 2 photos. Step 2 is the preview. Scene 1 of 3.")).toEqual([]);
    expect(handWrittenNumbers("updated: 2026-10-09")).toEqual([]);
  });

  it("finds none in the page content", () => {
    const dir = join(import.meta.dirname, "../content/pages");
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) =>
      f.endsWith(".mdx"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files)
      expect(handWrittenNumbers(readFileSync(join(dir, file), "utf8")), file).toEqual([]);
  });
});
