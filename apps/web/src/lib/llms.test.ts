import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms.ts";

describe("llms.txt", () => {
  it("describes the product with catalog numbers and links live pages only", () => {
    const text = llmsTxt("https://videozombiecouple.com");
    expect(text.startsWith("# VideoZombieCouple")).toBe(true);
    expect(text).toContain("$4.99");
    expect(text).toContain("12-second");
    expect(text).toContain("https://videozombiecouple.com/zombie-love-story-ai");
    expect(text).not.toContain("pet-zombie-video");
  });
});
