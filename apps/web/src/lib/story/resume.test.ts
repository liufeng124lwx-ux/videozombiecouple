import { describe, expect, it } from "vitest";
import { forgetStory, rememberedStory, rememberStory, renderKey } from "./resume.ts";

describe("resume", () => {
  it("remembers and forgets the current story", () => {
    expect(rememberedStory()).toBeNull();
    rememberStory("S1");
    expect(rememberedStory()).toBe("S1");
    forgetStory();
    expect(rememberedStory()).toBeNull();
  });
  it("keeps one render key per story", () => {
    let n = 0;
    const make = () => `k${++n}`;
    expect(renderKey("S1", make)).toBe("k1");
    expect(renderKey("S1", make)).toBe("k1");
    expect(renderKey("S2", make)).toBe("k2");
  });
});
