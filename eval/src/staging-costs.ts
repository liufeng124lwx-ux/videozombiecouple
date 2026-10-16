// What each staging film really cost: stories.cost_usd in staging D1 (the story runner sums every
// attempt's KIE creditsConsumed, describe included). Never the eval key's balance.
//   node eval/src/staging-costs.ts r2
// Runs `wrangler d1 execute vzc-staging --remote` with the operator's own wrangler login; reads no
// secret itself. Writes eval/results/<run>/costs.csv and costUsd into each films/*/*/story.json.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const EVAL = resolve(import.meta.dirname, "..");
const ROOT = resolve(EVAL, "..");
/** apps/api/wrangler.jsonc d1_databases[0].database_name (the staging config). */
export const STAGING_D1 = "vzc-staging";
/** Story ids are ULIDs. */
const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function costsQuery(ids: string[]): string {
  const bad = ids.filter((id) => !ID.test(id));
  if (bad.length) throw new Error(`not a story id: ${bad.join(", ")}`);
  return `SELECT id, status, scene, cost_usd, created_at, finished_at FROM stories WHERE id IN (${ids.map((id) => `'${id}'`).join(",")})`;
}

/** The command an operator can paste (printed by run-staging-films.ts). */
export function costsCommand(ids: string[]): string {
  return `pnpm --filter @vzc/api exec wrangler d1 execute ${STAGING_D1} --remote --json --command "${costsQuery(ids)}"`;
}

export type CostRow = { id: string; cost_usd: number; status?: string; scene?: string; created_at?: number; finished_at?: number | null };

/** wrangler --json prints [{results:[…], success, meta}]. */
export function parseD1Rows(stdout: string): CostRow[] {
  const start = stdout.indexOf("[");
  const parsed = JSON.parse(stdout.slice(start)) as { results?: CostRow[] }[];
  return parsed.flatMap((x) => x.results ?? []);
}

async function storyFiles(runDir: string): Promise<string[]> {
  const films = join(runDir, "films");
  if (!existsSync(films)) return [];
  const out: string[] = [];
  for (const scene of await readdir(films))
    for (const pair of await readdir(join(films, scene)).catch(() => [] as string[])) {
      const f = join(films, scene, pair, "story.json");
      if (existsSync(f)) out.push(f);
    }
  return out;
}

async function main() {
  const run = process.argv[2];
  if (!run) throw new Error("usage: node eval/src/staging-costs.ts <run>");
  const runDir = join(EVAL, "results", run);
  const files = await storyFiles(runDir);
  const logs = await Promise.all(files.map(async (f) => ({ f, log: JSON.parse(await readFile(f, "utf8")) as Record<string, unknown> })));
  const ids = logs.map((l) => l.log.storyId).filter((x): x is string => typeof x === "string");
  if (!ids.length) throw new Error(`no story ids under ${runDir}/films`);
  const stdout = execFileSync("pnpm", ["--filter", "@vzc/api", "exec", "wrangler", "d1", "execute", STAGING_D1, "--remote", "--json", "--command", costsQuery(ids)], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const rows = parseD1Rows(stdout);
  const lines = ["story_id,scene,pair,status,cost_usd,minutes"];
  for (const { f, log } of logs) {
    const row = rows.find((r) => r.id === log.storyId);
    if (!row) continue;
    log.costUsd = row.cost_usd;
    await writeFile(f, JSON.stringify(log, null, 2));
    lines.push([row.id, log.scene, log.pair, row.status ?? log.status, row.cost_usd, log.minutes ?? ""].join(","));
  }
  await writeFile(join(runDir, "costs.csv"), lines.join("\n") + "\n");
  const costs = rows.map((r) => r.cost_usd).sort((a, b) => a - b);
  console.log(`${rows.length}/${ids.length} films found; cost per film: ${costs.map((c) => `$${c.toFixed(2)}`).join(", ")} (acceptance: ≤ $2.30 each); wrote ${join(runDir, "costs.csv")}`);
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
