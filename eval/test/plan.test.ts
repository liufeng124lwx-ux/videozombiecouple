import { test } from "node:test";
import assert from "node:assert/strict";
import { planKeyframes, planShots } from "../src/plan.ts";
import { IMAGE_CANDIDATES, VIDEO_CANDIDATES } from "../src/candidates.ts";
import { SHOTS } from "../src/storyboard.ts";
import type { Pair } from "../src/personas.ts";

const pairs: Pair[] = [
  { id: "p01", kind: "human", survivor: "personas/p01-survivor.jpg", infected: "personas/p01-infected.jpg" },
  { id: "p02", kind: "human", survivor: "personas/p02-survivor.jpg", infected: "personas/p02-infected.jpg" },
];
const nb2 = IMAGE_CANDIDATES.filter((c) => c.key === "nb2");

test("stage AC: pairs × models × {A,C} × candidates, refs are the two photos", () => {
  const { specs } = planKeyframes({ pairs, models: nb2, stage: "AC", candidates: 2, dataDir: "/d", runDir: "/r", picks: {} });
  assert.equal(specs.length, 2 * 1 * 2 * 2);
  assert.deepEqual(specs[0].refs, ["/d/personas/p01-survivor.jpg", "/d/personas/p01-infected.jpg"]);
  assert.equal(specs[0].out, "/r/kf/nb2/p01/A-1.jpg");
  assert.equal(specs[0].key, "nb2|p01|A|1");
});

test("stage B needs picked A and C, otherwise reports missing", () => {
  const picks = { p01: { nb2: { A: "/r/a.jpg", C: "/r/c.jpg" } } };
  const { specs, missing } = planKeyframes({ pairs, models: nb2, stage: "B", candidates: 2, dataDir: "/d", runDir: "/r", picks });
  assert.equal(specs.length, 1); // one B per pair/model, candidates only apply to stage AC
  assert.equal(specs[0].out, "/r/kf/nb2/p01/B-1.jpg");
  assert.deepEqual(specs[0].refs.slice(2), ["/r/a.jpg", "/r/c.jpg"]);
  assert.deepEqual(missing, ["p02/nb2"]);
});

test("shots use picked keyframes and round seconds per model", () => {
  const picks = { p01: { nb2: { A: "/a", B: "/b", C: "/c" } } };
  const sd = VIDEO_CANDIDATES.filter((c) => c.key === "sd2mini");
  const { specs, missing } = planShots({ pairs, models: sd, shots: SHOTS, kfModel: "nb2", runDir: "/r", picks });
  assert.equal(specs.length, 4);
  const s3 = specs.find((s) => s.shot.id === 3)!;
  assert.equal(s3.first, "/a");
  assert.equal(s3.last, "/b");
  assert.equal(s3.sec, 4);
  assert.equal(s3.out, "/r/shots/sd2mini/p01/shot3.mp4");
  assert.deepEqual(missing, ["p02/nb2"]);
});
