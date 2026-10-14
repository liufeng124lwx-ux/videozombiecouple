// Generate keyframes A/C (stage AC) or B (stage B, needs picks.json from face_score.py).
//   node eval/src/run-keyframes.ts --run r1 --stage AC|B [--models nb2,sd5pro] [--pairs p01,p02] [--kind human] [--candidates 2] [--budget 10] [--concurrency 4] [--yes]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { IMAGE_CANDIDATES } from "./candidates.ts";
import { loadPairs } from "./personas.ts";
import { planKeyframes, type Picks } from "./plan.ts";

const EVAL = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    run: { type: "string", default: "r1" },
    stage: { type: "string", default: "AC" },
    models: { type: "string" },
    pairs: { type: "string" },
    kind: { type: "string", default: "human" },
    candidates: { type: "string", default: "2" },
    budget: { type: "string", default: "10" },
    concurrency: { type: "string", default: "4" },
    yes: { type: "boolean", default: false },
  },
});

async function main() {
  if (args.stage !== "AC" && args.stage !== "B") throw new Error("--stage must be AC or B");
  const runDir = join(EVAL, "results", args.run!);
  const picksFile = join(runDir, "picks.json");
  const picks: Picks = existsSync(picksFile) ? JSON.parse(await readFile(picksFile, "utf8")) : {};
  const pairs = (await loadPairs(EVAL)).filter((p) => p.kind === args.kind && (!args.pairs || args.pairs.split(",").includes(p.id)));
  const models = args.models ? IMAGE_CANDIDATES.filter((c) => args.models!.split(",").includes(c.key)) : IMAGE_CANDIDATES;
  const { specs, missing } = planKeyframes({ pairs, models, stage: args.stage, candidates: Number(args.candidates), dataDir: join(EVAL, "data"), runDir, picks });
  if (missing.length) console.warn(`skipping (no picked A/C yet — run face_score.py first): ${missing.join(", ")}`);

  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));
  if (args.yes) await mkdir(runDir, { recursive: true });

  const jobs: Job[] = specs.map((s) => ({
    key: s.key,
    estUsd: s.model.estUsd(s.refs.length),
    meta: { model: s.model.key, pair: s.pair.id, frame: s.frame, cand: s.cand },
    run: async () => {
      const refs = await Promise.all(s.refs.map((p) => uploads.urlFor(p)));
      return runKieTask({
        kie,
        model: s.model.model,
        input: s.model.input({ prompt: s.prompt, refs }),
        estUsd: s.model.estUsd(s.refs.length),
        timeoutMs: 5 * 60_000,
        save: async (bytes) => {
          await mkdir(dirname(s.out), { recursive: true });
          await writeFile(s.out, bytes);
          return s.out;
        },
      });
    },
  }));
  await runJobs({ resultsFile: join(runDir, "kf", "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: args.yes });
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
