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
      expect(r.aspects).toContain("9:16");
    }
  });

  it("have unique ids and only string params", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    for (const r of ROUTES)
      for (const v of Object.values(r.params)) expect(typeof v).toBe("string");
  });
});
