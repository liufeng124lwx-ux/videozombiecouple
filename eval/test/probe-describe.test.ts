import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubUrls } from "../src/probe-describe.ts";

test("scrubUrls replaces every upload URL anywhere in the body", () => {
  const body = { a: "see https://tempfile.redpandaai.co/x/y.jpg", b: [{ url: "https://tempfile.redpandaai.co/x/z.jpg" }], n: 3 };
  const out = scrubUrls(body, ["https://tempfile.redpandaai.co/x/y.jpg", "https://tempfile.redpandaai.co/x/z.jpg"]);
  assert.deepEqual(out, { a: "see <upload-url>", b: [{ url: "<upload-url>" }], n: 3 });
});

test("scrubUrls also drops any other http(s) URL on the upload host", () => {
  const out = scrubUrls({ a: "https://tempfile.redpandaai.co/other.jpg ok" }, []);
  assert.deepEqual(out, { a: "<upload-url> ok" });
});
