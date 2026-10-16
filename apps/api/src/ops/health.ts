import { type CapabilityId, isTaskCapability, OPS } from "@vzc/catalog";
import { pickSeconds, planRoutes } from "@vzc/providers";
import { providerKit } from "../services/provider-kit.ts";
import { presign } from "../services/r2-presign.ts";
import { loadRoutes } from "../services/routes-store.ts";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";

export const HEALTH_SAMPLE = "samples/health.jpg";
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const HEALTH_PROMPT =
  "Cinematic film still of the same person in golden hour light, vertical 9:16. Keep the identity exact. No text.";

/**
 * Spec §8.3: one real call on the fixed sample through the capability's primary route. Task
 * capabilities only: describe is a synchronous chat call and has no task to submit.
 */
export async function healthCheck(
  env: Bindings,
  capability: CapabilityId,
  now: number,
  send: Send = deliver,
  sleep: (ms: number) => Promise<void> = realSleep,
): Promise<boolean> {
  const key = `health:${capability}`;
  const title = `Health check failed: ${capability}`;
  const fail = async (detail: string) => {
    await raise(env, { key, title, detail }, now, send);
    return false;
  };
  if (!isTaskCapability(capability)) return fail(`${capability} is not a task capability`);
  if (!(await env.BUCKET.head(HEALTH_SAMPLE))) return fail(`${HEALTH_SAMPLE} is missing from R2`);
  try {
    const route = planRoutes(await loadRoutes(env.DB), capability, "human").primary[0];
    if (!route) return fail("no enabled route");
    const { adapter } = providerKit(env);
    const imageUrl = await presign(env, HEALTH_SAMPLE, "GET", 3600);
    const input =
      capability === "shot"
        ? {
            prompt: HEALTH_PROMPT,
            images: [],
            first: imageUrl,
            seconds: pickSeconds(route, 1),
            aspect: "9:16",
          }
        : { prompt: HEALTH_PROMPT, images: [imageUrl], aspect: "9:16" };
    const { taskId } = await adapter.submit(
      route,
      input,
      `${env.API_ORIGIN}/v1/ops/health-callback`,
    );
    for (let waited = 0; waited <= OPS.healthTimeoutMs; waited += OPS.healthPollMs) {
      const status = await adapter.status(taskId);
      if (status.state === "success") {
        await resolve(env, key, title, now, send);
        return true;
      }
      if (status.state === "fail") return fail(`${route.model}: ${status.failMsg ?? "failed"}`);
      await sleep(OPS.healthPollMs);
    }
    return fail(`${route.model}: no result in ${OPS.healthTimeoutMs / 1000}s`);
  } catch (error) {
    return fail(String(error));
  }
}

/** Keyframes every hour; a short video shot on the 6-hourly round (it costs more). */
export async function checkHealth(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  await healthCheck(env, "keyframe", now, send);
  if (new Date(now).getUTCHours() % OPS.healthProEveryHours === 0)
    await healthCheck(env, "shot", now, send);
}
