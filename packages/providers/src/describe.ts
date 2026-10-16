import type { RouteSeed } from "@vzc/catalog";
import { classifyKie, USD_PER_KIE_CREDIT } from "./kie.ts";
import { ProviderError } from "./types.ts";

/** Reads the photos once and answers in text (christmas content spec §2.3). Synchronous: no taskId. */
export interface DescribeAdapter {
  describe(
    route: RouteSeed,
    prompt: string,
    images: string[],
  ): Promise<{ text: string; costUsd: number | null }>;
}

const KIE = "https://api.kie.ai";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null;

/**
 * Synchronous KIE chat calls on the path the model schema names: Claude models speak the Messages
 * API (content[].text), the others OpenAI chat completions (choices[0].message.content).
 * Errors carry only the code: never the answer, the prompt or the image URLs.
 */
export class KieDescriber implements DescribeAdapter {
  // Plain fields, not parameter properties: Node's strip-only TypeScript loads this file as is
  // (the eval scripts import it). The default calls fetch unbound to avoid "Illegal invocation".
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(apiKey: string, fetcher: typeof fetch = (input, init) => fetch(input, init)) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async describe(route: RouteSeed, prompt: string, images: string[]) {
    const claude = route.model.startsWith("claude-");
    const url = claude ? `${KIE}/claude/v1/messages` : `${KIE}/${route.model}/v1/chat/completions`;
    const content = claude
      ? [
          ...images.map((u) => ({ type: "image", source: { type: "url", url: u } })),
          { type: "text", text: prompt },
        ]
      : [
          ...images.map((u) => ({ type: "image_url", image_url: { url: u } })),
          { type: "text", text: prompt },
        ];
    const body = claude
      ? { model: route.model, max_tokens: 200, messages: [{ role: "user", content }] }
      : { messages: [{ role: "user", content }], stream: false };
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(route.timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && /timeout|abort/i.test(error.name);
      throw new ProviderError(timedOut ? "timeout" : "provider_error", "describe request failed");
    }
    const raw: unknown = await response.json().catch(() => null);
    const code = isObject(raw) && typeof raw.code === "number" ? raw.code : null;
    if (!response.ok || (code !== null && code !== 200)) {
      const fail = {
        code: code ?? response.status,
        msg: isObject(raw) && typeof raw.msg === "string" ? raw.msg : "",
      };
      throw new ProviderError(classifyKie(fail), `describe failed (${fail.code})`, fail.code);
    }
    // KIE may wrap a success in {code, msg, data}; the probe saw the bare body for Claude.
    const payload = isObject(raw) && isObject(raw.data) ? raw.data : isObject(raw) ? raw : null;
    const text = claude ? claudeText(payload) : openaiText(payload);
    if (!text) throw new ProviderError("provider_error", "describe returned no text");
    // Credits are read from the unwrapped payload only (bare body, or `data` inside an envelope).
    const credits = payload?.credits_consumed;
    const costUsd =
      typeof credits === "number" && Number.isFinite(credits) && credits >= 0
        ? Math.round(credits * USD_PER_KIE_CREDIT * 1e6) / 1e6
        : route.costUsd;
    return { text, costUsd };
  }
}

function claudeText(p: Json | null): string {
  const blocks = Array.isArray(p?.content) ? (p.content as unknown[]) : [];
  return blocks
    .filter(isObject)
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
}

function openaiText(p: Json | null): string {
  const choices = Array.isArray(p?.choices) ? (p.choices as unknown[]) : [];
  const first = choices[0];
  const message = isObject(first) && isObject(first.message) ? first.message : null;
  const c = message?.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c))
    return c
      .filter(isObject)
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
  return "";
}
