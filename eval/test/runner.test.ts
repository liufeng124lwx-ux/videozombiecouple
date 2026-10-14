import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobFailed, readRows, runJobs, type Job } from "../src/runner.ts";

const tmp = async () => join(await mkdtemp(join(tmpdir(), "vzc-run-")), "results.jsonl");
const ok = (key: string, cost = 1): Job => ({ key, estUsd: cost, meta: { key }, run: async () => ({ costUsd: cost, outputs: [`${key}.jpg`] }) });

test("dry run plans and spends nothing", async () => {
  const file = await tmp();
  let ran = 0;
  const jobs = [ok("a"), { ...ok("b"), run: async () => (ran++, { costUsd: 1, outputs: [] }) }];
  const s = await runJobs({ resultsFile: file, jobs, budgetUsd: 10, concurrency: 2, execute: false });
  assert.equal(s.planned, 2);
  assert.equal(s.estUsd, 2);
  assert.equal(ran, 0);
});

test("estimate over budget refuses to run", async () => {
  const file = await tmp();
  await assert.rejects(runJobs({ resultsFile: file, jobs: [ok("a", 6), ok("b", 6)], budgetUsd: 10, concurrency: 1, execute: true }), /exceeds budget/);
});

test("rerun skips succeeded jobs and retries failed ones", async () => {
  const file = await tmp();
  let attempts = 0;
  const flaky: Job = { key: "f", estUsd: 1, meta: {}, run: async () => { attempts++; if (attempts === 1) throw new Error("boom"); return { costUsd: 1, outputs: [] }; } };
  await runJobs({ resultsFile: file, jobs: [ok("a"), flaky], budgetUsd: 10, concurrency: 1, execute: true });
  const s2 = await runJobs({ resultsFile: file, jobs: [ok("a"), flaky], budgetUsd: 10, concurrency: 1, execute: true });
  assert.equal(s2.skipped, 1);
  assert.equal(s2.succeeded, 1);
  assert.equal(attempts, 2);
});

test("spending stops once the budget is reached", async () => {
  const file = await tmp();
  // estimates are low, real costs are high: the guard must use real spend
  const jobs = ["a", "b", "c", "d"].map((k) => ({ ...ok(k, 1), run: async () => ({ costUsd: 4, outputs: [] }) }));
  const s = await runJobs({ resultsFile: file, jobs, budgetUsd: 10, concurrency: 1, execute: true });
  assert.equal(s.succeeded, 3);
  assert.equal(s.aborted, "budget");
});

test("a fatal failure aborts the run and records its cost", async () => {
  const file = await tmp();
  const fatal: Job = { key: "x", estUsd: 1, meta: { m: 1 }, run: async () => { throw new JobFailed("code=402", 0, true); } };
  const s = await runJobs({ resultsFile: file, jobs: [fatal, ok("b")], budgetUsd: 10, concurrency: 1, execute: true });
  assert.match(s.aborted ?? "", /402/);
  const rows = await readRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.deepEqual(rows[0].meta, { m: 1 });
});
