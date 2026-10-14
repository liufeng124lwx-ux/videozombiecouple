import { type CapabilityId, MODES, OPS } from "@vzc/catalog";
import { planRoutes } from "@vzc/providers";
import { providerKit } from "../services/provider-kit.ts";
import { presign } from "../services/r2-presign.ts";
import { loadRoutes } from "../services/routes-store.ts";
import type { Bindings } from "../types.ts";
import { deliver, raise, resolve, type Send } from "./alerts.ts";

export const HEALTH_SAMPLE = "samples/health.jpg";
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Spec 8.2: one real job on the fixed sample through the capability's primary route. */
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
  if (!(await env.BUCKET.head(HEALTH_SAMPLE))) return fail(`${HEALTH_SAMPLE} is missing from R2`);
  try {
    const route = planRoutes(await loadRoutes(env.DB), capability, "auto").primary[0];
    if (!route) return fail("no enabled route");
    const { adapter } = providerKit(env);
    const imageUrl = await presign(env, HEALTH_SAMPLE, "GET", 3600);
    const { taskId } = await adapter.submit(
      route,
      { imageUrl, prompt: MODES.auto.prompt, aspect: route.aspects[0] ?? "4:3" },
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

/** Standard every hour; Pro on the 6-hourly round (spec 8.2). */
export async function checkHealth(env: Bindings, now: number, send: Send = deliver): Promise<void> {
  await healthCheck(env, "unblur.std", now, send);
  if (new Date(now).getUTCHours() % OPS.healthProEveryHours === 0)
    await healthCheck(env, "unblur.pro", now, send);
}
