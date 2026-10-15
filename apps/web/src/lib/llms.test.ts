import { fact } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { llmsTxt } from "./llms.ts";

describe("llms.txt", () => {
  it("describes the product with catalog numbers and links live pages only", () => {
    const text = llmsTxt("https://videozombiecouple.com");
    expect(text.startsWith("# VideoZombieCouple")).toBe(true);
    expect(text).toContain("$4.99");
    expect(text).toContain(`${fact("video.seconds")}-second`);
    expect(text).toContain("https://videozombiecouple.com/zombie-love-story-ai");
    expect(text).toContain("pet-zombie-video");
    // Paid-only since 2026-10-15: no free preview, films kept by email status.
    expect(text).not.toMatch(/free preview[^s]/i);
    expect(text).toContain(`${fact("retention.memberFilmDays")} days once the email is confirmed`);
    expect(text).toContain("remade once for free");
    // Drafts never appear.
    expect(text).not.toContain("zombie-love-story-prompts");
  });
});
