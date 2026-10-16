import assert from "node:assert/strict";
import { test } from "node:test";

test("KieDescriber loads under plain node (no parameter properties) and reads the answer", async () => {
  const { KieDescriber } = await import("../../packages/providers/src/describe.ts");
  const fetcher = (async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: "IMAGE 1: short black hair\nIMAGE 2: bald" }], credits_consumed: 0.06 }), { status: 200 })) as typeof fetch;
  const d = new KieDescriber("k", fetcher);
  const route = { model: "claude-haiku-5-5", timeoutMs: 1000, costUsd: 0.001 } as any;
  const out = await d.describe(route, "p", ["u1", "u2"]);
  assert.match(out.text, /IMAGE 2: bald/);
  assert.equal(out.costUsd, 0.0003);
});
