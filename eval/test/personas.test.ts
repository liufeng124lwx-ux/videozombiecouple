import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, portraitPrompt } from "../src/personas.ts";

test("10 human pairs and 2 pet pairs with unique ids", () => {
  assert.equal(PERSONAS.filter((p) => p.kind === "human").length, 10);
  assert.equal(PERSONAS.filter((p) => p.kind === "pet").length, 2);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, PERSONAS.length);
});

test("portrait prompt asks for a single front-facing subject", () => {
  const p = portraitPrompt("woman in her 30s", false);
  assert.match(p, /woman in her 30s/);
  assert.match(p, /single person/);
  assert.match(portraitPrompt("orange tabby cat", true), /single animal/);
});
