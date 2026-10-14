// Generate the synthetic subject photos once and write eval/data/pairs.json.
//   node eval/src/run-personas.ts [--budget 2] [--yes]
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { PERSONAS, portraitPrompt, type Pair } from "./personas.ts";

const EVAL = resolve(import.meta.dirname, "..");
const OUT = join(EVAL, "data", "personas");
const MODEL = "nano-banana-2";
const EST = 0.025;

const { values: args } = parseArgs({ options: { budget: { type: "string", default: "2" }, yes: { type: "boolean", default: false } } });

async function main() {
  await mkdir(OUT, { recursive: true });
  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const jobs: Job[] = PERSONAS.flatMap((p) =>
    (["survivor", "infected"] as const).map((role) => {
      const isAnimal = p.kind === "pet" && role === "infected";
      const file = join(OUT, `${p.id}-${role}.jpg`);
      return {
        key: `${p.id}-${role}`,
        estUsd: EST,
        meta: { pair: p.id, role },
        run: () =>
          runKieTask({
            kie,
            model: MODEL,
            input: { prompt: portraitPrompt(p[role], isAnimal), aspect_ratio: "3:4", resolution: "1K", output_format: "jpg" },
            estUsd: EST,
            timeoutMs: 5 * 60_000,
            save: async (bytes) => (await writeFile(file, bytes), file),
          }),
      };
    }),
  );
  const s = await runJobs({ resultsFile: join(OUT, "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: 4, execute: args.yes });
  if (!args.yes) return;
  const pairs: Pair[] = PERSONAS.map((p) => ({ id: p.id, kind: p.kind, survivor: `personas/${p.id}-survivor.jpg`, infected: `personas/${p.id}-infected.jpg` }));
  await writeFile(join(EVAL, "data", "pairs.json"), JSON.stringify(pairs, null, 2));
  console.log(`pairs.json written (${pairs.length} pairs). failed=${s.failed}: rerun to retry failures.`);
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
