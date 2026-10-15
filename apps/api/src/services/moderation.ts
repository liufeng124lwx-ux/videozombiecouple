import type { Bindings } from "../types.ts";

/**
 * Upload moderation (SeeAPI nsfw-filter, image-moderation): one task per photo, polled until it
 * finishes. check() throws whenever there is no verdict (a failed task, a rejected request, no
 * result, a timeout): a missing verdict is never a pass. What a failure means is the caller's call.
 */
export type ModerationVerdict = { flagged: boolean; labels: string[] };

export interface ModerationApi {
  check(imageUrl: string): Promise<ModerationVerdict>;
}

const API = "https://api.seeapi.com/v1/inferences";

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

type Task = {
  id?: unknown;
  status?: unknown;
  result?: { data?: { flagged?: unknown; categories?: Record<string, unknown> } } | null;
  error?: { code?: unknown; message?: unknown } | null;
};

export function seeApiModeration(
  key: string,
  { pollMs = 1_500, timeoutMs = 45_000 }: { pollMs?: number; timeoutMs?: number } = {},
): ModerationApi {
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const read = async (response: Response, what: string): Promise<Task> => {
    const body = (await response.json().catch(() => ({}))) as Task;
    if (!response.ok) throw new Error(`seeapi ${what}: ${response.status}`);
    return body;
  };
  return {
    async check(imageUrl) {
      const deadline = Date.now() + timeoutMs;
      let task = await read(
        await fetch(API, {
          method: "POST",
          headers: { ...headers, "idempotency-key": `vzc-${crypto.randomUUID()}` },
          body: JSON.stringify({
            model: "nsfw-filter",
            endpoint: "image-moderation",
            provider: "seeapi",
            input: { image_url: imageUrl },
          }),
          signal: AbortSignal.timeout(10_000),
        }),
        "create",
      );
      const id = typeof task.id === "string" ? task.id : null;
      if (!id) throw new Error("seeapi create: no task id");
      while (task.status !== "succeeded") {
        if (task.status === "failed" || task.status === "canceled")
          throw new Error(`seeapi task ${String(task.status)}: ${String(task.error?.code ?? "")}`);
        if (Date.now() >= deadline) throw new Error("seeapi task timed out");
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        task = await read(
          await fetch(`${API}/${encodeURIComponent(id)}`, {
            headers,
            signal: AbortSignal.timeout(10_000),
          }),
          "query",
        );
      }
      const data = task.result?.data;
      if (!data || typeof data.flagged !== "boolean") throw new Error("seeapi task: no result");
      return {
        flagged: data.flagged,
        labels: [...strings(data.categories?.nsfw), ...strings(data.categories?.special_care)],
      };
    },
  };
}

/** Null (moderation off) until SEEAPI_API_KEY is set; tests inject MODERATION_IMPL. */
export function moderationFor(env: Bindings): ModerationApi | null {
  if (env.MODERATION_IMPL) return env.MODERATION_IMPL;
  return env.SEEAPI_API_KEY ? seeApiModeration(env.SEEAPI_API_KEY) : null;
}
