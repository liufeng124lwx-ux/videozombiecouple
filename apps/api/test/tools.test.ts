import { NANO_BANANA_PRO_ASPECTS, SEEDREAM_ASPECTS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { setup } from "./harness.ts";

describe("GET /v1/tools (spec 3.1: pad to ratios every route of the capability accepts)", () => {
  it("returns the shared pad ratios per capability", async () => {
    const h = await setup();
    const response = await h.call("/v1/tools");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.body["unblur.std"]).toEqual({ pad: true, aspects: [...SEEDREAM_ASPECTS] });
    expect(response.body["unblur.pro"]).toEqual({ pad: true, aspects: [...SEEDREAM_ASPECTS] });
    expect(response.body["unblur.4k"]).toEqual({
      pad: true,
      aspects: NANO_BANANA_PRO_ASPECTS.filter((a) =>
        (SEEDREAM_ASPECTS as readonly string[]).includes(a),
      ),
    });
  });
});
