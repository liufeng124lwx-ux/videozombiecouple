import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KieClient, KieError, UploadCache, parseRecord } from "../src/kie.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error("no more fake responses");
    return r;
  }) as typeof fetch;
  return { impl, calls };
}
const noSleep = async () => {};

test("createTask returns taskId and sends model + input", async () => {
  const f = fakeFetch([json({ code: 200, data: { taskId: "t1" } })]);
  const kie = new KieClient("k", f.impl, noSleep);
  assert.equal(await kie.createTask("m", { prompt: "x" }), "t1");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { model: "m", input: { prompt: "x" } });
});

test("createTask: HTTP 200 with body code 402 throws a fatal KieError", async () => {
  const f = fakeFetch([json({ code: 402, msg: "insufficient balance" })]);
  const kie = new KieClient("k", f.impl, noSleep);
  await assert.rejects(kie.createTask("m", {}), (e: unknown) => e instanceof KieError && e.code === 402 && e.fatal);
});

test("createTask: body code 422 is not fatal", async () => {
  const f = fakeFetch([json({ code: 422, msg: "bad input" })]);
  const kie = new KieClient("k", f.impl, noSleep);
  await assert.rejects(kie.createTask("m", {}), (e: unknown) => e instanceof KieError && !e.fatal);
});

test("parseRecord prefers response.resultUrls and returns null while running", () => {
  assert.equal(parseRecord({ state: "generating" }), null);
  const r = parseRecord({
    state: "success",
    response: { resultUrls: ["https://a/1.mp4"] },
    resultJson: "{\"resultUrls\":[\"https://b/2.mp4\"]}",
    creditsConsumed: 40,
    costTime: 61,
  });
  assert.deepEqual(r, { state: "success", urls: ["https://a/1.mp4"], creditsConsumed: 40, costTimeSec: 61, failMsg: undefined });
});

test("parseRecord falls back to resultJson and reports failMsg", () => {
  assert.deepEqual(parseRecord({ state: "success", resultJson: "{\"resultUrls\":[\"u\"]}" })?.urls, ["u"]);
  assert.equal(parseRecord({ state: "fail", failMsg: "nsfw" })?.failMsg, "nsfw");
});

test("wait polls until terminal state", async () => {
  const f = fakeFetch([
    json({ code: 200, data: { state: "queuing" } }),
    json({ code: 200, data: { state: "success", response: { resultUrls: ["u"] }, creditsConsumed: 3 } }),
  ]);
  const kie = new KieClient("k", f.impl, noSleep);
  const r = await kie.wait("t1", 60_000);
  assert.equal(r.state, "success");
  assert.equal(f.calls.length, 2);
});

test("wait times out instead of polling forever", async () => {
  const responses = Array.from({ length: 50 }, () => json({ code: 200, data: { state: "generating" } }));
  const f = fakeFetch(responses);
  let now = 0;
  const kie = new KieClient("k", f.impl, async (ms) => {
    now += ms;
  });
  const realNow = Date.now;
  Date.now = () => now;
  try {
    await assert.rejects(kie.wait("t1", 30_000), /timed out/);
  } finally {
    Date.now = realNow;
  }
});

test("UploadCache uploads once and reuses the url within 20h", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vzc-"));
  const file = join(dir, "a.jpg");
  await writeFile(file, "jpegbytes");
  let uploads = 0;
  let clock = 1_000;
  const cache = new UploadCache({ upload: async () => `https://u/${++uploads}` }, join(dir, "cache.json"), () => clock);
  assert.equal(await cache.urlFor(file), "https://u/1");
  clock += 19 * 3600_000;
  assert.equal(await cache.urlFor(file), "https://u/1");
  clock += 2 * 3600_000;
  assert.equal(await cache.urlFor(file), "https://u/2");
});
