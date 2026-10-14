import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_CANDIDATES, VIDEO_CANDIDATES, pickSeconds } from "../src/candidates.ts";

const video = (k: string) => VIDEO_CANDIDATES.find((c) => c.key === k)!;
const image = (k: string) => IMAGE_CANDIDATES.find((c) => c.key === k)!;

test("pickSeconds rounds up to the model's minimum and allowed values", () => {
  assert.equal(pickSeconds(video("sd2mini"), 2.5), 4);
  assert.equal(pickSeconds(video("kling3std"), 2.5), 3);
  assert.equal(pickSeconds(video("veo31lite"), 3), 4);
  assert.equal(pickSeconds(video("veo31lite"), 5), 6);
  assert.equal(pickSeconds(video("wan27"), 2.5), 3);
});

test("seedance uses first/last frame fields, no audio, 9:16", () => {
  const i = video("sd2mini").input({ prompt: "p", first: "f", last: "l", sec: 4 });
  assert.deepEqual(i, { prompt: "p", first_frame_url: "f", last_frame_url: "l", resolution: "720p", aspect_ratio: "9:16", duration: 4, generate_audio: false });
});

test("first-frame-only shots omit last frame fields", () => {
  assert.equal("last_frame_url" in video("sd2fast").input({ prompt: "p", first: "f", sec: 4 }), false);
  assert.deepEqual(video("kling3std").input({ prompt: "p", first: "f", sec: 3 }).image_urls, ["f"]);
  assert.deepEqual(video("veo31lite").input({ prompt: "p", first: "f", last: "l", sec: 4 }).image_urls, ["f", "l"]);
});

test("kling wants duration as a string and no sound", () => {
  const i = video("kling3std").input({ prompt: "p", first: "f", sec: 3 });
  assert.equal(i.duration, "3");
  assert.equal(i.sound, false);
  assert.equal(i.multi_shots, false);
});

test("image candidates pass all refs under each model's own field", () => {
  const refs = ["a", "b", "c", "d"];
  assert.deepEqual(image("nb2").input({ prompt: "p", refs }).image_input, refs);
  assert.deepEqual(image("sd5pro").input({ prompt: "p", refs }).image_urls, refs);
  assert.deepEqual(image("gptimg2").input({ prompt: "p", refs }).input_urls, refs);
  assert.deepEqual(image("flux2pro").input({ prompt: "p", refs }).input_urls, refs);
  assert.equal(image("sd5pro").estUsd(4), 0.035 + 3 * 0.0025);
});
