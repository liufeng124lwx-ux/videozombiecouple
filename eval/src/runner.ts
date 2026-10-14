// Resumable, budget-guarded job runner. Results append to <run>/<stage>/results.jsonl.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export type JobOutcome = { costUsd: number; outputs: string[]; meta?: Record<string, unknown> };
export type Job = { key: string; estUsd: number; meta: Record<string, unknown>; run: () => Promise<JobOutcome> };
export type RunSummary = { planned: number; skipped: number; estUsd: number; spentUsd: number; succeeded: number; failed: number; aborted: string | null };

export class JobFailed extends Error {
  costUsd: number;
  fatal: boolean;
  constructor(message: string, costUsd: number, fatal = false) {
    super(message);
    this.costUsd = costUsd;
    this.fatal = fatal;
  }
}

export async function readRows(resultsFile: string): Promise<Record<string, any>[]> {
  if (!existsSync(resultsFile)) return [];
  return (await readFile(resultsFile, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export async function runJobs(o: {
  resultsFile: string;
  jobs: Job[];
  budgetUsd: number;
  concurrency: number;
  execute: boolean;
  log?: (s: string) => void;
}): Promise<RunSummary> {
  const log = o.log ?? console.log;
  const done = new Set((await readRows(o.resultsFile)).filter((r) => r.status === "succeeded").map((r) => r.key));
  const todo = o.jobs.filter((j) => !done.has(j.key));
  const estUsd = todo.reduce((s, j) => s + j.estUsd, 0);
  const s: RunSummary = { planned: todo.length, skipped: o.jobs.length - todo.length, estUsd, spentUsd: 0, succeeded: 0, failed: 0, aborted: null };
  log(`jobs=${todo.length} (skipping ${s.skipped} done) estimated=$${estUsd.toFixed(2)} budget=$${o.budgetUsd}`);
  if (estUsd > o.budgetUsd) throw new Error(`estimated cost $${estUsd.toFixed(2)} exceeds budget $${o.budgetUsd}; narrow --models/--pairs`);
  if (!o.execute) {
    log("dry run — add --yes to execute");
    return s;
  }
  await mkdir(dirname(o.resultsFile), { recursive: true });

  let next = 0;
  const worker = async () => {
    while (next < todo.length && !s.aborted) {
      if (s.spentUsd >= o.budgetUsd) {
        s.aborted ??= "budget";
        return;
      }
      const job = todo[next++];
      const t0 = Date.now();
      const row: Record<string, unknown> = { key: job.key, meta: job.meta };
      try {
        const out = await job.run();
        s.spentUsd += out.costUsd;
        s.succeeded++;
        Object.assign(row, { status: "succeeded", costUsd: out.costUsd, outputs: out.outputs, meta: { ...job.meta, ...out.meta } });
      } catch (e) {
        const cost = e instanceof JobFailed ? e.costUsd : 0;
        s.spentUsd += cost;
        s.failed++;
        Object.assign(row, { status: "failed", costUsd: cost, error: String((e as Error).message ?? e) });
        if (e instanceof JobFailed && e.fatal) s.aborted = String(row.error);
      }
      row.latencyMs = Date.now() - t0;
      row.at = new Date().toISOString();
      await appendFile(o.resultsFile, JSON.stringify(row) + "\n");
      log(`${row.status === "succeeded" ? "✓" : "✗"} ${job.key} $${Number(row.costUsd).toFixed(3)} ${((row.latencyMs as number) / 1000).toFixed(0)}s${row.error ? " " + row.error : ""} (spent $${s.spentUsd.toFixed(2)})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  log(`done: ${s.succeeded} ok, ${s.failed} failed, spent ≈ $${s.spentUsd.toFixed(2)}${s.aborted ? `, aborted: ${s.aborted}` : ""}`);
  return s;
}
