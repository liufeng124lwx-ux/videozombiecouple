import { readFileSync } from "node:fs";
import { ROUTES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { FakeDescriber, KieDescriber, ProviderError } from "../src/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const route = (id: string) => {
  const r = ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`no route ${id}`);
  return r;
};
function fetcherReturning(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("KieDescriber", () => {
  it("sends Claude-style image blocks then the prompt, and reads the text answer", async () => {
    const f = fetcherReturning(fixture("describe-claude.json"));
    const out = await new KieDescriber("k", f.fn).describe(
      route("describe:claude-haiku:1"),
      "PROMPT",
      ["u1", "u2"],
    );
    expect(f.calls[0]?.url).toBe("https://api.kie.ai/claude/v1/messages");
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "url", url: "u1" } },
      { type: "image", source: { type: "url", url: "u2" } },
      { type: "text", text: "PROMPT" },
    ]);
    expect((f.calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(out.text).toMatch(/IMAGE 1:/);
  });

  it("reports the cost KIE charged when the answer carries credits_consumed", async () => {
    const f = fetcherReturning(fixture("describe-claude.json"));
    const out = await new KieDescriber("k", f.fn).describe(route("describe:claude-haiku:1"), "P", [
      "u1",
      "u2",
    ]);
    const credits = JSON.parse(fixture("describe-claude.json")).credits_consumed as number;
    expect(out.costUsd).toBeCloseTo(credits * 0.005, 9);
  });

  it("falls back to the route's average cost when no credits are reported", async () => {
    const f = fetcherReturning('{"content":[{"type":"text","text":"IMAGE 1: a\\nIMAGE 2: b"}]}');
    const r = route("describe:claude-haiku:1");
    const out = await new KieDescriber("k", f.fn).describe(r, "P", ["u1", "u2"]);
    expect(out.costUsd).toBe(r.costUsd);
  });

  it("sends OpenAI-style image_url parts to the Gemini route and reads choices[0]", async () => {
    const f = fetcherReturning(fixture("describe-gemini-openai.json"));
    const r = ROUTES.find((x) => x.capability === "describe" && x.rank === 2);
    if (!r) throw new Error("no fallback describe route");
    const out = await new KieDescriber("k", f.fn).describe(r, "PROMPT", ["u1", "u2"]);
    expect(f.calls[0]?.url).toBe(`https://api.kie.ai/${r.model}/v1/chat/completions`);
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body.messages[0].content[0]).toEqual({ type: "image_url", image_url: { url: "u1" } });
    expect(body.stream).toBe(false);
    expect(out.text).toMatch(/IMAGE 2:/);
  });

  it("treats a code in the body as the outcome, even with HTTP 200", async () => {
    const f = fetcherReturning(fixture("describe-error.json"), 200);
    await expect(
      new KieDescriber("k", f.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "key_daily_cap" });
  });

  it("classifies HTTP errors and empty answers", async () => {
    const http = fetcherReturning('{"error":"busy"}', 429);
    await expect(
      new KieDescriber("k", http.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toBeInstanceOf(ProviderError);
    const empty = fetcherReturning('{"content":[]}');
    await expect(
      new KieDescriber("k", empty.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toMatchObject({ kind: "provider_error" });
  });

  it("never puts the answer or image URLs in the error message", async () => {
    const f = fetcherReturning('{"code":500,"msg":"internal error, please try again later."}');
    const err = await new KieDescriber("k", f.fn)
      .describe(route("describe:claude-haiku:1"), "P", ["https://secret.test/a.jpg", "u2"])
      .then(() => null)
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err?.message).not.toMatch(/secret\.test|u2/);
  });

  it("turns a network failure into a ProviderError", async () => {
    const boom = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      new KieDescriber("k", boom).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "provider_error" });
  });
});

describe("FakeDescriber", () => {
  it("answers in order and can fail", async () => {
    const fake = new FakeDescriber(["IMAGE 1: a", { error: "provider_error" }]);
    const r = route("describe:claude-haiku:1");
    expect((await fake.describe(r, "p", ["1", "2"])).text).toBe("IMAGE 1: a");
    await expect(fake.describe(r, "p", ["1", "2"])).rejects.toMatchObject({
      kind: "provider_error",
    });
  });

  it("repeats the last answer once the script runs out, and records calls", async () => {
    const fake = new FakeDescriber();
    const r = route("describe:claude-haiku:1");
    const a = await fake.describe(r, "p", ["1", "2"]);
    const b = await fake.describe(r, "p", ["3", "4"]);
    expect(a.text).toBe(b.text);
    expect(a.text).toMatch(/IMAGE 1: .+\nIMAGE 2: .+/);
    expect(fake.calls).toEqual([
      { model: "claude-haiku-5-5", images: ["1", "2"] },
      { model: "claude-haiku-5-5", images: ["3", "4"] },
    ]);
  });
});
