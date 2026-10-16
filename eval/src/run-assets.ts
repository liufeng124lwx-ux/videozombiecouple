// Christmas scene assets (christmas content spec §4), made in three stages with a human pick between:
//   node eval/src/run-assets.ts --run assets-r1                          # the whole plan and estimate
//   node eval/src/run-assets.ts --run assets-r1 --stage ornament --yes   # 2 ornament candidates
//   node eval/src/run-assets.ts --run assets-r1 --stage frames --yes     # hands (with the picked ornament) + 3 windows, 2 candidates each
//   node eval/src/run-assets.ts --run assets-r1 --stage clips --yes      # Kling 5 s from the picked hands/window frames
// Picks: write eval/results/<run>/asset-picks.json by hand, e.g.
//   {"ornament": "ornament-2.jpg", "hands": "hands-1.jpg", "window-snow-cabin": "window-snow-cabin-2.jpg", …}
// Nothing is copied into assets/stories/: a person picks and copies, then records it in its README.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CHRISTMAS } from "../../packages/catalog/src/index.ts";
import { IMAGE_CANDIDATES, VIDEO_CANDIDATES } from "./candidates.ts";
import { loadKey } from "./env.ts";
import { runKieTask } from "./kie-job.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { IMAGE_USD, isQuotaError, KLING_USD_PER_SEC, meter, QUOTA_MESSAGE, usd } from "./spend.ts";

const EVAL = resolve(import.meta.dirname, "..");
const CLIP_SEC = 5;
const STYLE = "Cinematic film still, vertical 9:16, 35mm film grain.";

/** The prompts, kept here and written next to the outputs as prompts.json. */
export const ASSET_PROMPTS = {
  ornament:
    "Product photo of one red glass heart-shaped Christmas ornament with a gold ribbon loop tied in a small bow at the top, glossy glass with soft reflections, a little worn with age, centred on a plain warm off-white background, soft studio light. A single object, no other ornaments, no text.",
  hands: `${STYLE} Close-up from above of an elderly person's wrinkled hands with age spots opening a faded red cardboard box on a wooden table in cold blue moonlight; inside, on yellowed tissue paper, lies the red glass heart ornament with a gold ribbon exactly as in IMAGE 1, and the thumb brushes it. Only the hands, no face. No text, no rings, no distorted hands, no extra fingers.`,
  window: {
    "snow-cabin": "a snow-covered wooden cabin at night",
    "city-flat": "an old brick apartment building on a snowy city street at night",
    farmhouse: "a farmhouse alone in snowy fields at night",
  } as Record<string, string>,
  windowPrompt: (place: string) =>
    `${STYLE} Seen from outside: ${place}, just before dawn; one frosted window glows warm amber with a fully lit Christmas tree inside, snow falling softly, the sky pale blue turning white at the horizon. No people visible, no text.`,
  handsClip:
    "The old hands lift the heart ornament gently out of the box and carry it up out of frame; the thumb brushes it once. Static camera. Subtle, restrained motion, no extra fingers.",
  windowClip: "Snow keeps falling past the warm lit window while the dawn sky slowly brightens. Very slow push-in. Subtle, restrained motion.",
};

type Stage = "ornament" | "frames" | "clips";
type AssetJob = { key: string; stage: Stage; out: string; estUsd: number; kind: "t2i" | "i2i" | "clip"; prompt: string; refs: string[] };

/** Every asset job; refs are pick names, resolved from asset-picks.json when the stage runs. */
export function planAssets(runDir: string, scenes: string[]): AssetJob[] {
  const jobs: AssetJob[] = [];
  for (const c of [1, 2]) jobs.push({ key: `ornament-${c}`, stage: "ornament", out: join(runDir, `ornament-${c}.jpg`), estUsd: IMAGE_USD, kind: "t2i", prompt: ASSET_PROMPTS.ornament, refs: [] });
  for (const c of [1, 2]) jobs.push({ key: `hands-${c}`, stage: "frames", out: join(runDir, `hands-${c}.jpg`), estUsd: IMAGE_USD, kind: "i2i", prompt: ASSET_PROMPTS.hands, refs: ["ornament"] });
  for (const s of scenes)
    for (const c of [1, 2])
      jobs.push({ key: `window-${s}-${c}`, stage: "frames", out: join(runDir, `window-${s}-${c}.jpg`), estUsd: IMAGE_USD, kind: "t2i", prompt: ASSET_PROMPTS.windowPrompt(ASSET_PROMPTS.window[s]!), refs: [] });
  jobs.push({ key: "hands-clip", stage: "clips", out: join(runDir, "hands.mp4"), estUsd: CLIP_SEC * KLING_USD_PER_SEC, kind: "clip", prompt: ASSET_PROMPTS.handsClip, refs: ["hands"] });
  for (const s of scenes) jobs.push({ key: `window-${s}-clip`, stage: "clips", out: join(runDir, `window-${s}.mp4`), estUsd: CLIP_SEC * KLING_USD_PER_SEC, kind: "clip", prompt: ASSET_PROMPTS.windowClip, refs: [`window-${s}`] });
  return jobs;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      run: { type: "string", default: "assets-r1" },
      stage: { type: "string" },
      scenes: { type: "string" },
      budget: { type: "string", default: "10" },
      concurrency: { type: "string", default: "3" },
      resume: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const runDir = join(EVAL, "results", args.run!);
  const scenes = args.scenes ? args.scenes.split(",") : Object.keys(CHRISTMAS.scenes);
  const unknown = scenes.filter((s) => !ASSET_PROMPTS.window[s]);
  if (unknown.length) throw new Error(`no window prompt for scene(s): ${unknown.join(", ")}`);
  if (args.stage && !["ornament", "frames", "clips"].includes(args.stage)) throw new Error("--stage must be ornament, frames or clips");
  const all = planAssets(runDir, scenes);
  const jobs = args.stage ? all.filter((j) => j.stage === args.stage) : all;
  const picksFile = join(runDir, "asset-picks.json");
  const picks: Record<string, string> = existsSync(picksFile) ? JSON.parse(await readFile(picksFile, "utf8")) : {};

  console.log(`Christmas scene assets → ${runDir} (never copied into assets/stories/ automatically)`);
  for (const stage of ["ornament", "frames", "clips"] as Stage[]) {
    const here = jobs.filter((j) => j.stage === stage);
    if (!here.length) continue;
    const need = [...new Set(here.flatMap((j) => j.refs))];
    console.log(`  ${stage}: ${here.map((j) => j.key).join(", ")} ≈ ${usd(here.reduce((s, j) => s + j.estUsd, 0))}${need.length ? ` (needs picks: ${need.join(", ")})` : ""}`);
  }
  const est = jobs.reduce((s, j) => s + j.estUsd, 0);
  console.log(`estimated ${usd(est)} (images $${IMAGE_USD} each, Kling ${CLIP_SEC} s × $${KLING_USD_PER_SEC}/s); budget $${args.budget}`);
  if (!args.yes) {
    console.log("dry run — add --stage <ornament|frames|clips> --yes to execute one stage");
    return;
  }
  if (!args.stage) throw new Error("--yes needs --stage: one stage at a time, with a human pick between");
  const missing = [...new Set(jobs.flatMap((j) => j.refs))].filter((r) => !picks[r] || !existsSync(join(runDir, picks[r]!)));
  if (missing.length) throw new Error(`asset-picks.json lacks a pick for: ${missing.join(", ")} — nothing was spent`);
  if (jobs.some((j) => existsSync(j.out)) && !args.resume) throw new Error(`${args.stage} outputs already exist: pass --resume to make only the missing ones`);

  const key = await loadKey();
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "prompts.json"), JSON.stringify({ ...ASSET_PROMPTS, window: Object.fromEntries(scenes.map((s) => [s, ASSET_PROMPTS.windowPrompt(ASSET_PROMPTS.window[s]!)])), windowPrompt: undefined }, null, 2));
  const m = await meter(key);
  const kie = new KieClient(key);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));
  const i2i = IMAGE_CANDIDATES.find((c) => c.key === "gptimg2")!;
  const kling = VIDEO_CANDIDATES.find((c) => c.key === "kling3std")!;
  const save = (out: string) => async (bytes: Uint8Array) => (await writeFile(out, bytes), out);
  try {
    const todo: Job[] = jobs
      .filter((j) => !existsSync(j.out))
      .map((j) => ({
        key: j.key,
        estUsd: j.estUsd,
        meta: { stage: j.stage, asset: j.key },
        run: async () => {
          const refs = await Promise.all(j.refs.map((r) => uploads.urlFor(join(runDir, picks[r]!))));
          if (j.kind === "clip")
            return runKieTask({ kie, model: kling.model, input: kling.input({ prompt: j.prompt, first: refs[0]!, sec: CLIP_SEC }), estUsd: j.estUsd, timeoutMs: 15 * 60_000, save: save(j.out) });
          if (j.kind === "i2i") return runKieTask({ kie, model: i2i.model, input: i2i.input({ prompt: j.prompt, refs }), estUsd: j.estUsd, timeoutMs: 5 * 60_000, save: save(j.out) });
          const aspect = j.key.startsWith("ornament") ? "1:1" : "9:16";
          return runKieTask({ kie, model: "gpt-image-2-text-to-image", input: { prompt: j.prompt, aspect_ratio: aspect, resolution: "1K" }, estUsd: j.estUsd, timeoutMs: 5 * 60_000, save: save(j.out) });
        },
      }));
    const s = await runJobs({ resultsFile: join(runDir, "results.jsonl"), jobs: todo, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: true });
    if (s.aborted && isQuotaError(s.aborted)) {
      console.error(QUOTA_MESSAGE);
      process.exitCode = 2;
    } else if (s.aborted) throw new Error(`stopped: ${s.aborted}`);
  } finally {
    await m.end();
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
