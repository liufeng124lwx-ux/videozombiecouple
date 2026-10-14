import { describe, expect, it } from "vitest";
import { buildKieInput, ProviderError, pickSeconds } from "../src/index.ts";
import { route } from "./route-fixture.ts";

const images = ["s", "i", "a", "c"];

describe("buildKieInput", () => {
  it("image edit models get all reference images under their own field", () => {
    const input = { prompt: "p", images, aspect: "9:16" };
    expect(buildKieInput(route("nano-banana-2"), input)).toMatchObject({
      image_input: images,
      aspect_ratio: "9:16",
    });
    expect(buildKieInput(route("seedream/5-pro-image-to-image"), input)).toMatchObject({
      image_urls: images,
    });
    expect(buildKieInput(route("gpt-image-2-image-to-image"), input)).toMatchObject({
      input_urls: images,
    });
    expect(buildKieInput(route("flux-2/pro-image-to-image"), input)).toMatchObject({
      input_urls: images,
    });
  });

  it("seedance uses first/last frame, no audio, integer seconds and the route params", () => {
    expect(
      buildKieInput(route("bytedance/seedance-2-mini", { params: { resolution: "720p" } }), {
        prompt: "p",
        images: [],
        first: "f",
        last: "l",
        seconds: 4,
        aspect: "9:16",
      }),
    ).toEqual({
      prompt: "p",
      first_frame_url: "f",
      last_frame_url: "l",
      aspect_ratio: "9:16",
      duration: 4,
      generate_audio: false,
      resolution: "720p",
    });
  });

  it("first-frame-only shots omit the last frame", () => {
    const input = { prompt: "p", images: [], first: "f", seconds: 4, aspect: "9:16" };
    expect("last_frame_url" in buildKieInput(route("bytedance/seedance-2-fast"), input)).toBe(
      false,
    );
    expect(buildKieInput(route("kling-3.0/video"), { ...input, seconds: 3 })).toMatchObject({
      image_urls: ["f"],
      duration: "3",
      sound: false,
      multi_shots: false,
    });
    expect(buildKieInput(route("veo-3-1"), { ...input, last: "l" })).toMatchObject({
      generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO",
      image_urls: ["f", "l"],
      duration: 4,
    });
    expect(buildKieInput(route("wan/2-7-image-to-video"), input)).toMatchObject({
      first_frame_url: "f",
      prompt_extend: false,
    });
  });

  it("video routes without a first frame are invalid", () => {
    expect(() =>
      buildKieInput(route("bytedance/seedance-2-mini"), {
        prompt: "p",
        images: [],
        seconds: 4,
        aspect: "9:16",
      }),
    ).toThrow(ProviderError);
  });

  it("rejects aspects the route does not accept", () => {
    expect(() =>
      buildKieInput(route("nano-banana-2"), { prompt: "p", images, aspect: "21:9" }),
    ).toThrow(ProviderError);
  });
});

describe("pickSeconds", () => {
  it("rounds up to the route minimum and to allowed values", () => {
    expect(pickSeconds(route("bytedance/seedance-2-mini", { minSec: 4, maxSec: 15 }), 2.5)).toBe(4);
    expect(pickSeconds(route("kling-3.0/video", { minSec: 3, maxSec: 15 }), 2.5)).toBe(3);
    expect(pickSeconds(route("veo-3-1", { minSec: 4, maxSec: 8, allowedSec: [4, 6, 8] }), 5)).toBe(
      6,
    );
    expect(pickSeconds(route("veo-3-1", { minSec: 4, maxSec: 8, allowedSec: [4, 6, 8] }), 12)).toBe(
      8,
    );
  });
});
