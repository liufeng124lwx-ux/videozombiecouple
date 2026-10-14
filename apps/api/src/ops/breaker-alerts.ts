import type { Bindings } from "../types.ts";
import { raise, resolve } from "./alerts.ts";

const title = (model: string) => `Breaker open: ${model}`;

/** Spec 8.3: one alert when a model's breaker opens, one "Resolved" when its probe succeeds. */
export async function breakerChanged(
  env: Bindings,
  model: string,
  open: boolean,
  now: number,
): Promise<void> {
  const key = `breaker:${model}`;
  if (open)
    await raise(
      env,
      {
        key,
        title: title(model),
        detail: "More than half of its recent calls failed; jobs go to the fallback for 5 minutes.",
      },
      now,
    );
  else await resolve(env, key, title(model), now);
}
