import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateKeyframes, estimateFilms, planXmasRounds, planXmasJobs } from "../src/run-xmas-keyframes.ts";
import { creditFrom, measured, QUOTA_MESSAGE, isQuotaError } from "../src/spend.ts";
import { KieError } from "../src/kie.ts";

test("round one holds the four scored frames; then tree and forgetWarm; then embrace", () => {
  assert.deepEqual(planXmasRounds(), [
    ["wide", "memory", "forgetCold", "rememberClose"],
    ["tree", "forgetWarm"],
    ["embrace"],
  ]);
});

test("estimates stay inside one round's budget", () => {
  assert.ok(estimateKeyframes({ pairs: 5, scenes: 3 }) < 10);
  assert.ok(estimateFilms(4) < 10);
});

test("estimates follow the spec formulas", () => {
  assert.equal(Number(estimateKeyframes({ pairs: 1, scenes: 1 }).toFixed(4)), 0.166);
  assert.equal(Number(estimateFilms(3).toFixed(2)), 5.76);
});

test("one pair and scene plans 11 images: 8 candidates, then 3 single frames", () => {
  const jobs = planXmasJobs({ pairs: ["p01"], scenes: ["snow-cabin"] });
  assert.equal(jobs.length, 11);
  assert.deepEqual(
    jobs.filter((j) => j.round === 1).map((j) => `${j.frame}-${j.cand}`),
    ["wide-1", "wide-2", "memory-1", "memory-2", "forgetCold-1", "forgetCold-2", "rememberClose-1", "rememberClose-2"],
  );
  assert.deepEqual(jobs.filter((j) => j.round > 1).map((j) => j.frame), ["tree", "forgetWarm", "embrace"]);
  assert.ok(jobs.every((j) => j.out.includes("snow-cabin/p01/")));
});

test("credit balance is read only from a code-200 body with a numeric data", () => {
  assert.equal(creditFrom({ code: 200, data: 1234.5 }), 1234.5);
  assert.equal(creditFrom({ code: 401, data: null }), null);
  assert.equal(creditFrom(null), null);
});

test("measured spend = (before - after) credits x $0.005, or null when unknown", () => {
  assert.equal(measured(1000, 800), 1);
  assert.equal(measured(null, 800), null);
});

test("KIE 433 is the hourly quota: stop and resume later", () => {
  assert.ok(isQuotaError(new KieError("x", 433)));
  assert.ok(!isQuotaError(new KieError("x", 500)));
  assert.match(QUOTA_MESSAGE, /--resume/);
});

test("a signed frame link names its keyframe; anything else is unknown", async () => {
  const { frameIdOf } = await import("../src/run-staging-films.ts");
  assert.equal(frameIdOf("https://r2.example/kf/01J/kf-wide-2.jpg?X-Amz-Signature=abc"), "wide");
  assert.equal(frameIdOf("https://r2.example/kf/01J/kf-forgetWarm.jpg?sig=1"), "forgetWarm");
  assert.equal(frameIdOf("https://r2.example/kf/01J/kf-A-1.jpg"), null);
});

test("asset plan: 2 ornaments, hands + 3 windows (2 each), 4 Kling clips ≈ $1.6", async () => {
  const { planAssets } = await import("../src/run-assets.ts");
  const jobs = planAssets("/tmp/x", ["snow-cabin", "city-flat", "farmhouse"]);
  assert.equal(jobs.filter((j) => j.stage === "ornament").length, 2);
  assert.equal(jobs.filter((j) => j.stage === "frames").length, 8);
  assert.equal(jobs.filter((j) => j.stage === "clips").length, 4);
  const total = jobs.reduce((s, j) => s + j.estUsd, 0);
  assert.ok(total > 1.4 && total < 1.7);
});
