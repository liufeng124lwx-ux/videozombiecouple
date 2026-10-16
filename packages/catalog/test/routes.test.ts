import { describe, expect, it } from "vitest";
import { CAPABILITY_IDS, ROUTES } from "../src/index.ts";

describe("routes", () => {
  it("each capability has exactly one rank-1 route and at least one fallback", () => {
    for (const cap of CAPABILITY_IDS) {
      const rs = ROUTES.filter((r) => r.capability === cap && r.mode === null);
      expect(rs.filter((r) => r.rank === 1)).toHaveLength(1);
      expect(rs.some((r) => r.rank > 1)).toBe(true);
    }
  });

  it("video routes declare their duration limits and image routes do not", () => {
    for (const r of ROUTES) {
      if (r.capability === "shot") expect(r.minSec).toBeGreaterThan(0);
      else expect(r.minSec).toBeUndefined();
      if (r.capability !== "describe") expect(r.aspects).toContain("9:16");
    }
  });

  it("have unique ids and only string params", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    for (const r of ROUTES)
      for (const v of Object.values(r.params)) expect(typeof v).toBe("string");
  });

  it("follows the 2026-10-14 eval: GPT Image 2 for keyframes, Kling 3.0 for shots", () => {
    const primary = (cap: string) => ROUTES.find((r) => r.capability === cap && r.rank === 1);
    expect(primary("keyframe")?.model).toBe("gpt-image-2-image-to-image");
    expect(primary("shot")?.model).toBe("kling-3.0/video");
    // Seedance 2 Fast fails kie's content review on zombie frames; Wan 2.7 drifts faces.
    expect(
      ROUTES.some((r) => r.model === "bytedance/seedance-2-fast" || r.model.startsWith("wan/")),
    ).toBe(false);
  });

  it("has two describe routes, Claude Haiku first", () => {
    const d = ROUTES.filter((r) => r.capability === "describe").sort((a, b) => a.rank - b.rank);
    expect(d.map((r) => r.model)[0]).toBe("claude-haiku-5-5");
    expect(d).toHaveLength(2);
    expect(d.every((r) => r.aspects.length === 0 && r.costUsd <= 0.005)).toBe(true);
  });

  it("gives describe routes timeouts above their measured latency (Claude 19 s, Gemini 13–55 s)", () => {
    const t = (id: string) => ROUTES.find((r) => r.id === id)?.timeoutMs;
    expect(t("describe:claude-haiku:1")).toBe(45_000);
    expect(t("describe:gemini-flash:2")).toBe(60_000);
  });
});
