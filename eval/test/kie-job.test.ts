import { test } from "node:test";
import assert from "node:assert/strict";
import { KieError } from "../src/kie.ts";
import { JobFailed } from "../src/runner.ts";
import { runKieTask } from "../src/kie-job.ts";

const base = { model: "m", input: {}, estUsd: 0.5, timeoutMs: 1000 };
const save = async (_b: Uint8Array, _ct: string, i: number) => `out-${i}.mp4`;

test("success: cost from creditsConsumed, outputs saved", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "success" as const, urls: ["u"], creditsConsumed: 40, costTimeSec: 60 }),
    download: async () => ({ bytes: new Uint8Array([1]), contentType: "video/mp4" }),
  };
  const r = await runKieTask({ ...base, kie, save });
  assert.equal(r.costUsd, 0.2);
  assert.deepEqual(r.outputs, ["out-0.mp4"]);
  assert.equal(r.meta?.costTimeSec, 60);
});

test("createTask fatal KieError becomes fatal JobFailed with zero cost", async () => {
  const kie = { createTask: async () => { throw new KieError("code=433", 433); }, wait: async () => { throw new Error("unreachable"); }, download: async () => { throw new Error("unreachable"); } };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.fatal && e.costUsd === 0);
});

test("download failure still records the money kie charged", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "success" as const, urls: ["u"], creditsConsumed: 40, costTimeSec: 1 }),
    download: async () => { throw new Error("download failed: HTTP 404"); },
  };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.costUsd === 0.2 && !e.fatal);
});

test("timeout counts the estimate as spent", async () => {
  const kie = { createTask: async () => "t", wait: async () => { throw new Error("task t timed out after 1s"); }, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.costUsd === 0.5);
});

test("model-side failure carries failMsg and charged cost", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "fail" as const, urls: [], creditsConsumed: 0, costTimeSec: 1, failMsg: "content rejected" }),
    download: async () => ({ bytes: new Uint8Array(), contentType: "" }),
  };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && /content rejected/.test(e.message) && e.costUsd === 0);
});
