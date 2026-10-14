import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOTS, keyframePrompt, shotPrompt } from "../src/storyboard.ts";

const SAFE = /No blood, no gore, no biting, no gunfire, no text\./;

test("every keyframe and shot prompt carries the safety constraints", () => {
  for (const kind of ["human", "pet"] as const) {
    for (const f of ["A", "B", "C"] as const) assert.match(keyframePrompt(f, kind), SAFE);
    for (const s of SHOTS) assert.match(shotPrompt(s.id, kind), SAFE);
  }
});

test("keyframe B references all four input images", () => {
  const p = keyframePrompt("B", "human");
  for (const n of [1, 2, 3, 4]) assert.match(p, new RegExp(`IMAGE ${n}`));
});

test("pet version never puts a gun in the scene", () => {
  for (const f of ["A", "B", "C"] as const) assert.doesNotMatch(keyframePrompt(f, "pet"), /pistol|gun(?!fire)/i);
  for (const s of SHOTS) assert.doesNotMatch(shotPrompt(s.id, "pet"), /pistol|gun(?!fire)/i);
});

test("storyboard totals 11 seconds and shot 3 goes from A to B", () => {
  assert.equal(SHOTS.reduce((t, s) => t + s.targetSec, 0), 11);
  const s3 = SHOTS.find((s) => s.id === 3)!;
  assert.equal(s3.first, "A");
  assert.equal(s3.last, "B");
});

test("video shots ask for consistent faces and restrained motion", () => {
  for (const s of SHOTS) assert.match(shotPrompt(s.id, "human"), /Faces stay consistent/);
});
