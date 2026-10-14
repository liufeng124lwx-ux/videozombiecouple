import type { RouteSeed } from "@vzc/catalog";
import {
  type FailKind,
  type JobInput,
  type ProviderAdapter,
  ProviderError,
  type StatusResult,
} from "./types.ts";

export const KIE_API = "https://api.kie.ai/api/v1";
/** kie bills in credits; 1 credit = $0.005 (kie pricing, 2026-10-08). */
export const USD_PER_KIE_CREDIT = 0.005;

type KieEnvelope<T> = { code?: number; msg?: string; data?: T | null };
type KieRecord = {
  state?: string;
  creditsConsumed?: unknown;
  costTime?: unknown;
  failCode?: unknown;
  failMsg?: unknown;
  resultJson?: unknown;
  response?: { resultUrls?: unknown } | null;
};

/** The model-specific `input` object for createTask (field names from the kie schema API). */
export function buildKieInput(route: RouteSeed, input: JobInput): Record<string, unknown> {
  if (!route.aspects.includes(input.aspect))
    throw new ProviderError("invalid", `aspect ${input.aspect} is not accepted by ${route.model}`);
  if (route.model.startsWith("seedream/"))
    return {
      prompt: input.prompt,
      image_urls: [input.imageUrl],
      aspect_ratio: input.aspect,
      ...route.params,
    };
  if (route.model.startsWith("nano-banana"))
    return {
      prompt: input.prompt,
      image_input: [input.imageUrl],
      aspect_ratio: input.aspect,
      ...route.params,
    };
  throw new ProviderError("invalid", `no kie input mapping for model ${route.model}`);
}

const CONTENT = /nsfw|content polic|safety|violat|sensitive|prohibited/i;
const KEY_DAILY_CAP = /exceeded the daily limit/i;
const TIMEOUT = /time(d)? ?out/i;

/** Spec 4.3. Message checks come before 400/422 so a rejected photo still switches models. */
export function classifyKie(fail: { code?: number | string; msg?: string }): FailKind {
  const code = Number(fail.code);
  const msg = fail.msg ?? "";
  // 433 is kie's code for a key past its daily limit; the message check covers a changed code.
  if (code === 433 || KEY_DAILY_CAP.test(msg)) return "key_daily_cap";
  if (code === 429) return "rate_limited";
  if (CONTENT.test(msg)) return "content_rejected";
  if (TIMEOUT.test(msg)) return "timeout";
  if (code === 400 || code === 422) return "invalid";
  return "provider_error";
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function resultUrls(record: KieRecord): string[] {
  const direct = record.response?.resultUrls;
  const urls = Array.isArray(direct) ? direct.filter(isString) : [];
  if (urls.length > 0) return urls;
  try {
    const parsed = JSON.parse(String(record.resultJson ?? "{}")) as { resultUrls?: unknown };
    return Array.isArray(parsed.resultUrls) ? parsed.resultUrls.filter(isString) : [];
  } catch {
    return [];
  }
}

async function readJson<T>(response: Response): Promise<KieEnvelope<T> | null> {
  try {
    return (await response.json()) as KieEnvelope<T>;
  } catch {
    return null;
  }
}

function failure(body: KieEnvelope<unknown> | null, httpStatus: number): ProviderError {
  const code = body?.code ?? httpStatus;
  const msg = body?.msg ?? `HTTP ${httpStatus}`;
  return new ProviderError(classifyKie({ code, msg }), msg, code);
}

export class KieAdapter implements ProviderAdapter {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(options: { apiKey: string; fetch?: typeof fetch; requestTimeoutMs?: number }) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  }

  /** Every failure leaving the adapter is a ProviderError, including network errors and timeouts. */
  async #request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, {
        ...init,
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      throw new ProviderError("provider_error", String(error), "NETWORK");
    }
  }

  #headers(): HeadersInit {
    return { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json" };
  }

  async submit(
    route: RouteSeed,
    input: JobInput,
    callbackUrl: string,
  ): Promise<{ taskId: string }> {
    const response = await this.#request(`${KIE_API}/jobs/createTask`, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify({
        model: route.model,
        input: buildKieInput(route, input),
        callBackUrl: callbackUrl,
      }),
    });
    const body = await readJson<{ taskId?: unknown }>(response);
    const taskId = body?.data?.taskId;
    // kie reports errors in the body's `code`, often with HTTP 200 (review focus 2).
    if (body?.code !== 200 || typeof taskId !== "string") throw failure(body, response.status);
    return { taskId };
  }

  async status(taskId: string): Promise<StatusResult> {
    const response = await this.#request(
      `${KIE_API}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: this.#headers(),
      },
    );
    const body = await readJson<KieRecord>(response);
    const record = body?.data;
    if (body?.code !== 200 || !record) throw failure(body, response.status);

    const costUsd =
      typeof record.creditsConsumed === "number"
        ? round6(record.creditsConsumed * USD_PER_KIE_CREDIT)
        : null;
    if (record.state === "success") {
      const urls = resultUrls(record);
      if (urls.length === 0)
        return {
          state: "fail",
          costUsd,
          failCode: "NO_OUTPUT",
          failMsg: "kie reported success without result URLs",
        };
      // costTime is in seconds (createTime/completeTime differ by the same amount).
      const costTimeMs = typeof record.costTime === "number" ? record.costTime * 1000 : null;
      return { state: "success", outputUrls: urls, costUsd, costTimeMs };
    }
    if (record.state === "fail") {
      const result: Extract<StatusResult, { state: "fail" }> = { state: "fail", costUsd };
      if (record.failCode !== null && record.failCode !== undefined)
        result.failCode = String(record.failCode);
      if (isString(record.failMsg)) result.failMsg = record.failMsg;
      return result;
    }
    return { state: "pending" };
  }

  classify(fail: { code?: number | string; msg?: string }): FailKind {
    return classifyKie(fail);
  }
}

/** Spec 8.2: the account balance in dollars (GET /api/v1/chat/credit returns kie credits). */
export async function kieBalance(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const response = await fetchImpl("https://api.kie.ai/api/v1/chat/credit", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const body = (await response.json()) as { code?: number; msg?: string; data?: unknown };
  if (body.code !== 200 || typeof body.data !== "number")
    throw new Error(body.msg ?? "kie balance failed");
  return body.data * USD_PER_KIE_CREDIT;
}
