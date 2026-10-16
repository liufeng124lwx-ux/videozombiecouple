// R1 (christmas content spec §5): Christmas keyframes in story order, straight on KIE.
//   node eval/src/run-xmas-keyframes.ts --run r1 [--scenes snow-cabin,city-flat,farmhouse] [--pairs p01,p03,p06,p07,p09]
//        [--model gptimg2] [--ornament assets/stories/christmas/shared/ornament.jpg] [--budget 10] [--concurrency 4] [--resume] [--yes]
// Order, as the API's step graph runs it: describe each pair → round 1 (the scored frames, 2
// candidates each) → xmas_face.py picks (xmas-picks.json) → round 2 (tree, forgetWarm) → round 3 (embrace) → scoring.
// Without --yes: prints the plan and the estimate only. Outputs: eval/results/<run>/kf/<scene>/<pair>/.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CHRISTMAS, EMPTY_APPEARANCE, parseAppearance, type Appearance, type FrameRef } from "../../packages/catalog/src/index.ts";
import { IMAGE_CANDIDATES } from "./candidates.ts";
import { loadKey } from "./env.ts";
import { runKieTask } from "./kie-job.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { loadPairs } from "./personas.ts";
import { describeOnce, describeRoutes } from "./run-describe.ts";
import { runJobs, type Job } from "./runner.ts";
import { DESCRIBE_USD, estimateFilms, estimateKeyframes, IMAGE_USD, isQuotaError, meter, QUOTA_MESSAGE, usd } from "./spend.ts";

export { estimateFilms, estimateKeyframes };

const EVAL = resolve(import.meta.dirname, "..");
const ROOT = resolve(EVAL, "..");
export const R1_SCENES = ["snow-cabin", "city-flat", "farmhouse"];
export const R1_PAIRS = ["p01", "p03", "p06", "p07", "p09"];

/**
 * Rounds from the keyframes' refs, the same rule as the API's step graph: a frame that refers only
 * to photos and assets is round 1; otherwise one more than the latest frame it refers to.
 */
export function planXmasRounds(): string[][] {
  const round = new Map<string, number>();
  for (const k of CHRISTMAS.keyframes) {
    const deps = k.refs.flatMap((r) => ("frame" in r ? [r.frame] : []));
    const missing = deps.filter((d) => !round.has(d));
    if (missing.length) throw new Error(`${k.id} refers to ${missing.join(",")} before it is made`);
    round.set(k.id, deps.length ? 1 + Math.max(...deps.map((d) => round.get(d)!)) : 1);
  }
  const rounds: string[][] = [];
  for (const [id, r] of round) (rounds[r - 1] ??= []).push(id);
  return rounds;
}

export type XmasJob = { key: string; scene: string; pair: string; frame: string; cand: number | null; round: number; refs: readonly FrameRef[]; out: string };

/** Every image of one run: round by round, keyframes in catalog order, candidates numbered. */
export function planXmasJobs(o: { pairs: string[]; scenes: string[]; runDir?: string }): XmasJob[] {
  const runDir = o.runDir ?? join(EVAL, "results", "r1");
  const rounds = planXmasRounds();
  const jobs: XmasJob[] = [];
  for (const [i, ids] of rounds.entries()) {
    for (const scene of o.scenes) {
      for (const pair of o.pairs) {
        for (const id of ids) {
          const k = CHRISTMAS.keyframes.find((x) => x.id === id)!;
          const cands = k.candidates >= 2 ? Array.from({ length: k.candidates }, (_, c) => c + 1) : [null];
          for (const cand of cands) {
            const file = cand === null ? `${id}.jpg` : `${id}-${cand}.jpg`;
            jobs.push({ key: `${scene}|${pair}|${id}|${cand ?? 0}`, scene, pair, frame: id, cand, round: i + 1, refs: k.refs, out: join(runDir, "kf", scene, pair, file) });
          }
        }
      }
    }
  }
  return jobs;
}

type Picks = Record<string, Record<string, Record<string, string>>>;
/** Written by xmas_face.py; its own name so an older zombie run's picks.json is never touched. */
const PICKS = "xmas-picks.json";

/** Scores every keyframe and (re)writes picks.json; features stay inside the Python process. */
function scoreRun(runDir: string) {
  const r = spawnSync("uv", ["run", join(EVAL, "scripts", "xmas_face.py"), runDir], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("xmas_face.py failed");
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      run: { type: "string", default: "r1" },
      scenes: { type: "string" },
      pairs: { type: "string" },
      model: { type: "string", default: "gptimg2" },
      ornament: { type: "string", default: join(ROOT, "assets", "stories", "christmas", "shared", "ornament.jpg") },
      budget: { type: "string", default: "10" },
      concurrency: { type: "string", default: "4" },
      resume: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const runDir = join(EVAL, "results", args.run!);
  const scenes = args.scenes ? args.scenes.split(",") : R1_SCENES;
  const unknownScene = scenes.filter((s) => !CHRISTMAS.scenes[s]);
  if (unknownScene.length) throw new Error(`unknown scene(s): ${unknownScene.join(", ")}`);
  const wanted = args.pairs ? args.pairs.split(",") : R1_PAIRS;
  const pairs = (await loadPairs(EVAL)).filter((p) => p.kind === "human" && wanted.includes(p.id));
  const model = IMAGE_CANDIDATES.find((c) => c.key === args.model);
  if (!model) throw new Error(`unknown --model ${args.model}`);
  const jobs = planXmasJobs({ pairs: pairs.map((p) => p.id), scenes, runDir });
  const est = estimateKeyframes({ pairs: pairs.length, scenes: scenes.length });
  const rounds = planXmasRounds();

  console.log(`R1 Christmas keyframes (${model.model}): ${pairs.length} pairs (${pairs.map((p) => p.id).join(",")}) × ${scenes.length} scenes (${scenes.join(",")})`);
  console.log(`  describe: ${pairs.length} calls (${describeRoutes()[0]!.model}, fallback ${describeRoutes()[1]?.model ?? "none"}) ≈ ${usd(pairs.length * DESCRIBE_USD)}`);
  for (const [i, ids] of rounds.entries()) {
    const n = jobs.filter((j) => j.round === i + 1).length;
    console.log(`  round ${i + 1}: ${ids.join(", ")} → ${n} images ≈ ${usd(n * IMAGE_USD)}${i === 0 ? " → xmas_face.py picks" : ""}`);
  }
  console.log(`estimated ${usd(est)} (pairs × scenes × 11 × $${IMAGE_USD} + pairs × $${DESCRIBE_USD}); budget $${args.budget}; outputs → ${runDir}`);
  const needsOrnament = CHRISTMAS.keyframes.some((k) => k.refs.some((r) => "asset" in r && r.asset === "ornament"));
  if (needsOrnament && !existsSync(args.ornament!)) console.warn(`missing ornament asset ${args.ornament}: run run-assets.ts, pick one, copy it there (or pass --ornament)`);
  if (!args.yes) {
    console.log("dry run — add --yes to execute");
    return;
  }
  if (est > Number(args.budget)) throw new Error(`estimate ${usd(est)} exceeds budget $${args.budget}; narrow --pairs/--scenes`);
  if (needsOrnament && !existsSync(args.ornament!)) throw new Error("no ornament asset: nothing was spent");
  if (scenes.some((s) => existsSync(join(runDir, "kf", s))) && !args.resume) throw new Error(`${runDir} already has results: pass --resume to continue, or use a new --run`);

  const key = await loadKey();
  await mkdir(runDir, { recursive: true });
  const m = await meter(key);
  const kie = new KieClient(key);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));
  const quota = () => {
    console.error(QUOTA_MESSAGE);
    process.exitCode = 2;
  };
  try {
    // Describe once per pair: the primary route, then the fallback, as the API does.
    const looks = new Map<string, Appearance>();
    for (const pair of pairs) {
      const file = join(runDir, "appearance", `${pair.id}.txt`);
      if (!existsSync(file)) {
        let raw = "";
        for (const route of describeRoutes()) {
          try {
            const images = [await uploads.urlFor(join(EVAL, "data", pair.survivor)), await uploads.urlFor(join(EVAL, "data", pair.infected))];
            raw = await describeOnce(key, route, images);
            break;
          } catch (e) {
            if (isQuotaError(e)) return quota();
            console.log(`describe ${pair.id} ${route.model}: ${(e as Error).message}`);
          }
        }
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, raw);
      }
      looks.set(pair.id, parseAppearance(await readFile(file, "utf8")));
    }

    const photo = (pairId: string, who: "survivor" | "infected") => join(EVAL, "data", pairs.find((p) => p.id === pairId)![who]);
    for (const [i] of rounds.entries()) {
      const picks: Picks = existsSync(join(runDir, PICKS)) ? JSON.parse(await readFile(join(runDir, PICKS), "utf8")) : {};
      const local = (j: XmasJob, r: FrameRef): string | null => {
        if ("photo" in r) return photo(j.pair, r.photo);
        if ("asset" in r) return r.asset === "ornament" ? args.ornament! : null;
        return picks[j.scene]?.[j.pair]?.[r.frame] ?? null;
      };
      const todo: Job[] = [];
      for (const j of jobs.filter((x) => x.round === i + 1)) {
        if (existsSync(j.out)) continue; // --resume: the image is already there
        const refs = j.refs.map((r) => local(j, r));
        if (refs.some((r) => r === null)) {
          console.warn(`skip ${j.key}: a referenced frame has no pick yet`);
          continue;
        }
        const k = CHRISTMAS.keyframes.find((x) => x.id === j.frame)!;
        const prompt = k.prompt(j.scene, "human", looks.get(j.pair) ?? EMPTY_APPEARANCE);
        todo.push({
          key: j.key,
          estUsd: IMAGE_USD,
          meta: { scene: j.scene, pair: j.pair, frame: j.frame, cand: j.cand, round: j.round },
          run: async () =>
            runKieTask({
              kie,
              model: model.model,
              input: model.input({ prompt, refs: await Promise.all((refs as string[]).map((p) => uploads.urlFor(p))) }),
              estUsd: IMAGE_USD,
              timeoutMs: 5 * 60_000,
              save: async (bytes) => {
                await mkdir(dirname(j.out), { recursive: true });
                await writeFile(j.out, bytes);
                return j.out;
              },
            }),
        });
      }
      console.log(`round ${i + 1}: ${todo.length} images to make`);
      const s = await runJobs({ resultsFile: join(runDir, "kf", "xmas-results.jsonl"), jobs: todo, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: true });
      if (s.aborted) {
        if (isQuotaError(s.aborted)) return quota();
        throw new Error(`stopped: ${s.aborted}`);
      }
      scoreRun(runDir); // picks for the next round, and faces.csv for this one
    }
  } finally {
    await m.end();
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
