import { test } from "node:test";
import assert from "node:assert/strict";
import { answerText, scrubUrls, selectProbes } from "../src/probe-describe.ts";

test("scrubUrls replaces every upload URL anywhere in the body", () => {
  const body = { a: "see https://tempfile.redpandaai.co/x/y.jpg", b: [{ url: "https://tempfile.redpandaai.co/x/z.jpg" }], n: 3 };
  const out = scrubUrls(body, ["https://tempfile.redpandaai.co/x/y.jpg", "https://tempfile.redpandaai.co/x/z.jpg"]);
  assert.deepEqual(out, { a: "see <upload-url>", b: [{ url: "<upload-url>" }], n: 3 });
});

test("scrubUrls also drops any other http(s) URL on the upload host", () => {
  const out = scrubUrls({ a: "https://tempfile.redpandaai.co/other.jpg ok" }, []);
  assert.deepEqual(out, { a: "<upload-url> ok" });
});

test("answerText accepts only HTTP 200 answers with no error code and real text", () => {
  const claude = { content: [{ type: "text", text: "IMAGE 1: a\nIMAGE 2: b" }] };
  const openai = { choices: [{ message: { content: "IMAGE 1: a\nIMAGE 2: b" } }] };
  assert.equal(answerText(200, claude, "claude"), "IMAGE 1: a\nIMAGE 2: b");
  assert.equal(answerText(200, openai, "openai"), "IMAGE 1: a\nIMAGE 2: b");
  assert.equal(answerText(200, { ...openai, code: 200 }, "openai"), "IMAGE 1: a\nIMAGE 2: b");
  assert.equal(answerText(200, { code: 500, msg: "internal error" }, "openai"), null);
  assert.equal(answerText(200, { ...claude, code: 433 }, "claude"), null);
  assert.equal(answerText(502, claude, "claude"), null);
  assert.equal(answerText(200, { nonJson: "<html>" }, "claude"), null);
  assert.equal(answerText(200, { content: [] }, "claude"), null);
  assert.equal(answerText(200, openai, "claude"), null);
});

test("the default probe list never includes the failing gemini-3-8 or two writers of one fixture", () => {
  const defaults = selectProbes(undefined);
  assert.ok(!defaults.some((p) => p.name === "gemini-3-8-flash-openai"));
  const fixtures = defaults.map((p) => p.fixture).filter(Boolean);
  assert.equal(new Set(fixtures).size, fixtures.length);
  const explicit = selectProbes(["gemini-3-8-flash-openai"]);
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].fixture, null);
});
