// Wrap one kie createTask → wait → download into a runner JobOutcome, classifying failures.
import { KieError, USD_PER_CREDIT, type KieClient } from "./kie.ts";
import { JobFailed, type JobOutcome } from "./runner.ts";

export async function runKieTask(o: {
  kie: Pick<KieClient, "createTask" | "wait" | "download">;
  model: string;
  input: Record<string, unknown>;
  estUsd: number;
  timeoutMs: number;
  save: (bytes: Uint8Array, contentType: string, index: number) => Promise<string>;
}): Promise<JobOutcome> {
  let taskId: string;
  try {
    taskId = await o.kie.createTask(o.model, o.input);
  } catch (e) {
    throw new JobFailed(String((e as Error).message), 0, e instanceof KieError && e.fatal);
  }
  let r;
  try {
    r = await o.kie.wait(taskId, o.timeoutMs);
  } catch (e) {
    // The task may still be billed: count the estimate so the budget guard stays honest.
    const fatal = e instanceof KieError && e.fatal;
    throw new JobFailed(`${taskId}: ${(e as Error).message}`, fatal ? 0 : o.estUsd, fatal);
  }
  const costUsd = r.creditsConsumed != null ? r.creditsConsumed * USD_PER_CREDIT : o.estUsd;
  if (r.state !== "success" || !r.urls.length) throw new JobFailed(`${taskId}: ${r.failMsg ?? "no output url"}`, costUsd);
  const outputs: string[] = [];
  try {
    for (const [i, url] of r.urls.entries()) {
      const d = await o.kie.download(url);
      outputs.push(await o.save(d.bytes, d.contentType, i));
    }
  } catch (e) {
    throw new JobFailed(`${taskId}: ${(e as Error).message}`, costUsd);
  }
  return { costUsd, outputs, meta: { taskId, costTimeSec: r.costTimeSec } };
}
