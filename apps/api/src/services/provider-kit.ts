import {
  type DescribeAdapter,
  type FailKind,
  FakeAdapter,
  FakeDescriber,
  type FakeStep,
  KieAdapter,
  KieDescriber,
  type ProviderAdapter,
  ProviderError,
} from "@vzc/providers";
import type { Bindings } from "../types.ts";

export type ProviderKit = {
  adapter: ProviderAdapter;
  /** Reads the two photos once, synchronously (christmas content spec §2.3). */
  describer: DescribeAdapter;
  /** Stores the provider's output at `destKey` in R2; throws a ProviderError when it cannot. */
  fetchOutput(url: string, inputKey: string, destKey: string): Promise<void>;
};

const DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * FAKE_PROVIDER=1 (spec 11.1): a scripted FakeAdapter whose "output" is a copy of the input, so the
 * whole pipeline runs without kie. The script is per JobRunner, so each job replays it from the top.
 */
export function providerKit(env: Bindings): ProviderKit {
  if (env.FAKE_PROVIDER === "1") {
    const script = env.FAKE_SCRIPT
      ? (JSON.parse(env.FAKE_SCRIPT) as Record<string, FakeStep[]>)
      : {};
    const adapter = new FakeAdapter(script);
    const log = env.FAKE_SUBMITTED;
    if (log) {
      const submit = adapter.submit.bind(adapter);
      adapter.submit = async (route, input, callbackUrl) => {
        const result = await submit(route, input, callbackUrl);
        log.push(adapter.submitted.at(-1));
        return result;
      };
    }
    const answers = env.FAKE_DESCRIBE
      ? (JSON.parse(env.FAKE_DESCRIBE) as (string | { error: FailKind })[])
      : undefined;
    return {
      adapter,
      describer: new FakeDescriber(answers),
      fetchOutput: async (_url, inputKey, destKey) => {
        const input = await env.BUCKET.get(inputKey);
        if (!input) throw new ProviderError("provider_error", `input ${inputKey} is gone`);
        await env.BUCKET.put(destKey, await input.arrayBuffer(), {
          httpMetadata: { contentType: "image/jpeg" },
        });
      },
    };
  }
  return {
    adapter: new KieAdapter({ apiKey: env.KIE_API_KEY }),
    // Workers refuse fetch called with another `this`: hand the describer a plain function.
    describer: new KieDescriber(env.KIE_API_KEY, (input, init) => fetch(input, init)),
    fetchOutput: async (url, _inputKey, destKey) => {
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      } catch (error) {
        throw new ProviderError("provider_error", `output download failed: ${String(error)}`);
      }
      if (!response.ok)
        throw new ProviderError(
          "provider_error",
          `output download failed: HTTP ${response.status}`,
          response.status,
        );
      await env.BUCKET.put(destKey, await response.arrayBuffer(), {
        httpMetadata: { contentType: response.headers.get("content-type") ?? "image/png" },
      });
    },
  };
}
