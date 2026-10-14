// Generate the 4 storyboard shots per pair per video model, from picked keyframes of one image model.
//   node eval/src/run-shots.ts --run r1 --kf-model nb2 [--models sd2mini,kling3std] [--pairs p01,p07] [--shots 1,2,3,4] [--kind human] [--budget 10] [--concurrency 3] [--yes]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { VIDEO_CANDIDATES } from "./candidates.ts";
import { loadPairs } from "./personas.ts";
import { SHOTS } from "./storyboard.ts";
import { planShots, type Picks } from "./plan.ts";

const EVAL = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    run: { type: "string", default: "r1" },
    "kf-model": { type: "string" },
    models: { type: "string" },
    pairs: { type: "string" },
    shots: { type: "string" },
    kind: { type: "string", default: "human" },
    budget: { type: "string", default: "10" },
    concurrency: { type: "string", default: "3" },
    yes: { type: "boolean", default: false },
  },
});

async function main() {
  const kfModel = args["kf-model"];
  if (!kfModel) throw new Error("--kf-model is required (image model whose picked keyframes to use)");
  const runDir = join(EVAL, "results", args.run!);
  const picksFile = join(runDir, "picks.json");
  if (!existsSync(picksFile)) throw new Error(`no ${picksFile}: run face_score.py after the keyframe stages`);
  const picks: Picks = JSON.parse(await readFile(picksFile, "utf8"));
  const pairs = (await loadPairs(EVAL)).filter((p) => p.kind === args.kind && (!args.pairs || args.pairs.split(",").includes(p.id)));
  const models = args.models ? VIDEO_CANDIDATES.filter((c) => args.models!.split(",").includes(c.key)) : VIDEO_CANDIDATES;
  const shots = args.shots ? SHOTS.filter((s) => args.shots!.split(",").includes(String(s.id))) : SHOTS;
  const { specs, missing } = planShots({ pairs, models, shots, kfModel, runDir, picks });
  if (missing.length) console.warn(`skipping (picks.json lacks A/B/C for ${kfModel}): ${missing.join(", ")}`);

  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));

  const jobs: Job[] = specs.map((s) => ({
    key: s.key,
    estUsd: s.model.estUsd(s.sec),
    meta: { kfModel, model: s.model.key, pair: s.pair.id, shot: s.shot.id, sec: s.sec, targetSec: s.shot.targetSec },
    run: async () => {
      const first = await uploads.urlFor(s.first);
      const last = s.last ? await uploads.urlFor(s.last) : undefined;
      return runKieTask({
        kie,
        model: s.model.model,
        input: s.model.input({ prompt: s.prompt, first, last, sec: s.sec }),
        estUsd: s.model.estUsd(s.sec),
        timeoutMs: 15 * 60_000,
        save: async (bytes) => {
          await mkdir(dirname(s.out), { recursive: true });
          await writeFile(s.out, bytes);
          return s.out;
        },
      });
    },
  }));
  await runJobs({ resultsFile: join(runDir, "shots", "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: args.yes });
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
