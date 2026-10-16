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

test("a describe ProviderError with code 433 is the quota too", async () => {
  const { ProviderError } = await import("../../packages/providers/src/types.ts");
  assert.ok(isQuotaError(new ProviderError("quota", "describe failed (433)", 433)));
});

test("requested pairs that are missing or not human are reported, not dropped silently", async () => {
  const { humanPairs } = await import("../src/personas.ts");
  const all = [
    { id: "p01", kind: "human" as const, survivor: "a", infected: "b" },
    { id: "q01", kind: "pet" as const, survivor: "c", infected: "d" },
  ];
  const warnings: string[] = [];
  const got = humanPairs(all, ["p01", "q01", "p99"], (s) => warnings.push(s));
  assert.deepEqual(got.map((p) => p.id), ["p01"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /q01.*not human/);
  assert.match(warnings[0]!, /p99.*unknown/);
});

test("an upload that hits the quota fails the job as fatal, so the run stops with the quota message", async () => {
  const { uploadRefs } = await import("../src/kie-job.ts");
  const { JobFailed } = await import("../src/runner.ts");
  const uploads = { urlFor: async () => { throw new KieError("upload failed: code=433", 433); } };
  await assert.rejects(uploadRefs(uploads, ["a.jpg"]), (e: unknown) => e instanceof JobFailed && e.fatal && isQuotaError(e));
});

test("staging films go only to the exact staging API origin", async () => {
  const { STAGING_API, checkApi } = await import("../src/run-staging-films.ts");
  assert.equal(checkApi(STAGING_API), STAGING_API);
  for (const bad of ["https://api.videozombiecouple.com", "https://api-staging.videozombiecouple.com.evil.test", "http://api-staging.videozombiecouple.com", "https://evil.test/?api-staging"])
    assert.throws(() => checkApi(bad), /only/);
});

test("film cost comes from staging D1: the query names only story ids, the JSON output is parsed", async () => {
  const { costsQuery, parseD1Rows } = await import("../src/staging-costs.ts");
  const q = costsQuery(["01JABCDEFGHJKMNPQRSTVWXYZ0", "01JDEFGHJKMNPQRSTVWXYZ0123"]);
  assert.match(q, /FROM stories WHERE id IN \('01JABCDEFGHJKMNPQRSTVWXYZ0','01JDEFGHJKMNPQRSTVWXYZ0123'\)/);
  assert.match(q, /cost_usd/);
  assert.throws(() => costsQuery(["x'; DROP TABLE stories;--"]), /story id/);
  const out = JSON.stringify([{ results: [{ id: "01JABCDEFGHJKMNPQRSTVWXYZ0", cost_usd: 1.87, status: "done", created_at: 1, finished_at: 481000 }], success: true }]);
  assert.deepEqual(parseD1Rows(out), [{ id: "01JABCDEFGHJKMNPQRSTVWXYZ0", cost_usd: 1.87, status: "done", created_at: 1, finished_at: 481000 }]);
});
