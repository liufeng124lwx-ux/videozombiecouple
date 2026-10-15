import { afterEach, describe, expect, it, vi } from "vitest";
import { moderationFor, seeApiModeration } from "../src/services/moderation.ts";

afterEach(() => vi.unstubAllGlobals());

type Answer = { status?: number; body: unknown };
function seeApi(answers: Answer[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const next = answers.length > 1 ? answers.shift() : answers[0];
      return Response.json(next?.body ?? {}, { status: next?.status ?? 200 });
    }),
  );
  return calls;
}
const task = (status: string, data: unknown = null, error: unknown = null) => ({
  body: { id: "task_1", status, result: data ? { type: "json", data } : null, error },
});

describe("SeeAPI image moderation", () => {
  it("submits the image, polls the task and reports the labels", async () => {
    const calls = seeApi([
      { status: 202, body: { id: "task_1", status: "processing", result: null } },
      task("processing"),
      task("succeeded", {
        flagged: true,
        categories: { nsfw: ["explicit_nudity"], special_care: ["minor"] },
      }),
    ]);
    const verdict = await seeApiModeration("sk_test_key", { pollMs: 1 }).check("https://r2/x.jpg");
    expect(verdict).toEqual({ flagged: true, labels: ["explicit_nudity", "minor"] });
    expect(calls[0]?.url).toBe("https://api.seeapi.com/v1/inferences");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk_test_key");
    expect(headers["idempotency-key"]).toMatch(/^vzc-/);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "nsfw-filter",
      endpoint: "image-moderation",
      provider: "seeapi",
      input: { image_url: "https://r2/x.jpg" },
    });
    expect(calls[1]?.url).toBe("https://api.seeapi.com/v1/inferences/task_1");
  });

  it("passes a clean photo", async () => {
    seeApi([
      { status: 202, body: { id: "task_1", status: "processing" } },
      task("succeeded", { flagged: false, categories: { nsfw: [], special_care: [] } }),
    ]);
    expect(await seeApiModeration("k", { pollMs: 1 }).check("https://r2/x.jpg")).toEqual({
      flagged: false,
      labels: [],
    });
  });

  it("throws on a failed task, a rejected request, a missing result or a timeout (never a silent pass)", async () => {
    const api = seeApiModeration("k", { pollMs: 1, timeoutMs: 50 });
    seeApi([
      { status: 202, body: { id: "task_1" } },
      task("failed", null, { code: "inference_failed" }),
    ]);
    await expect(api.check("u")).rejects.toThrow(/inference_failed/);
    seeApi([{ status: 401, body: { error: { message: "bad key" } } }]);
    await expect(api.check("u")).rejects.toThrow(/401/);
    seeApi([{ status: 202, body: { id: "task_1" } }, task("succeeded")]);
    await expect(api.check("u")).rejects.toThrow(/no result/);
    seeApi([{ status: 202, body: { id: "task_1" } }, task("processing")]);
    await expect(api.check("u")).rejects.toThrow(/timed out/);
  });

  it("is off without a key", () => {
    expect(moderationFor({} as never)).toBeNull();
    expect(moderationFor({ SEEAPI_API_KEY: "sk_x" } as never)).not.toBeNull();
  });
});
