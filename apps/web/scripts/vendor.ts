/** Spec 3.4: MediaPipe's wasm is served from our own origin, copied from the pinned package. */
import { cpSync, mkdirSync } from "node:fs";

const FROM = "node_modules/@mediapipe/tasks-vision/wasm";
const TO = "public/vendor/mediapipe";
const FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

mkdirSync(TO, { recursive: true });
for (const file of FILES) cpSync(`${FROM}/${file}`, `${TO}/${file}`);
console.log(`vendor: ${FILES.length} MediaPipe files in ${TO}`);
