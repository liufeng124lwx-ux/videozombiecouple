import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKey } from "../src/env.ts";

test("parseKey reads KIE_API_KEY line and trims it", () => {
  assert.equal(parseKey("FOO=1\nKIE_API_KEY= abc123 \n"), "abc123");
});

test("parseKey returns null when the line is missing", () => {
  assert.equal(parseKey("FOO=1\n"), null);
});
