import type { RouteSeed } from "@vzc/catalog";
import { classifyKie } from "./kie.ts";
import {
  type FailKind,
  type ProviderAdapter,
  ProviderError,
  type StatusResult,
  type TaskInput,
} from "./types.ts";

export type FakeStep =
  | { kind: "success"; pendingPolls?: number; outputUrl: string; costUsd?: number }
  | { kind: "fail"; pendingPolls?: number; failMsg: string; failCode?: string }
  | { kind: "submit_error"; code: number; msg: string }
  | { kind: "never" };

type Task = { step: FakeStep; polls: number };

/**
 * Scriptable stand-in for kie: per model, a queue of outcomes consumed one per submit.
 * Used by API integration tests and by FAKE_PROVIDER=1 (spec 11.1).
 */
export class FakeAdapter implements ProviderAdapter {
  readonly submitted: { taskId: string; model: string; input: TaskInput; callbackUrl: string }[] =
    [];
  readonly #script: Map<string, FakeStep[]>;
  readonly #fallback: FakeStep;
  readonly #tasks = new Map<string, Task>();
  #counter = 0;

  constructor(
    script: Record<string, FakeStep[]> = {},
    fallback: FakeStep = {
      kind: "success",
      pendingPolls: 1,
      outputUrl: "https://fake.test/out.png",
    },
  ) {
    this.#script = new Map(Object.entries(script).map(([model, steps]) => [model, [...steps]]));
    this.#fallback = fallback;
  }

  async submit(
    route: RouteSeed,
    input: TaskInput,
    callbackUrl: string,
  ): Promise<{ taskId: string }> {
    const step = this.#script.get(route.model)?.shift() ?? this.#fallback;
    if (step.kind === "submit_error")
      throw new ProviderError(classifyKie(step), step.msg, step.code);
    const taskId = `fake-${++this.#counter}`;
    this.#tasks.set(taskId, { step, polls: 0 });
    this.submitted.push({ taskId, model: route.model, input, callbackUrl });
    return { taskId };
  }

  async status(taskId: string): Promise<StatusResult> {
    const task = this.#tasks.get(taskId);
    if (!task) throw new ProviderError("invalid", `unknown task ${taskId}`, 404);
    task.polls += 1;
    const { step } = task;
    if (step.kind === "never" || step.kind === "submit_error") return { state: "pending" };
    if (task.polls <= (step.pendingPolls ?? 0)) return { state: "pending" };
    if (step.kind === "success")
      return {
        state: "success",
        outputUrls: [step.outputUrl],
        costUsd: step.costUsd ?? 0.0162,
        costTimeMs: 1000,
      };
    const result: Extract<StatusResult, { state: "fail" }> = {
      state: "fail",
      costUsd: 0,
      failMsg: step.failMsg,
    };
    if (step.failCode !== undefined) result.failCode = step.failCode;
    return result;
  }

  classify(fail: { code?: number | string; msg?: string }): FailKind {
    return classifyKie(fail);
  }
}
