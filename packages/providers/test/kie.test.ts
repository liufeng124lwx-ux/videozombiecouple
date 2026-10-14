import { ROUTES } from "@vzc/catalog";
import { describe, expect, it, vi } from "vitest";
import {
  buildKieInput,
  KIE_API,
  KieAdapter,
  kieBalance,
  ProviderError,
  USD_PER_KIE_CREDIT,
} from "../src/index.ts";

const route = (id: string) => {
  const found = ROUTES.find((r) => r.id === id);
  if (!found) throw new Error(`no route ${id}`);
  return found;
};
const input = {
  imageUrl: "https://r2.example/in/x.jpg",
  prompt: "Restore this photo",
  aspect: "4:3",
};

/** A fetch that answers with the given JSON bodies in order and records the requests. */
function fakeFetch(...bodies: unknown[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const body = bodies.shift();
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("buildKieInput", () => {
  it("maps Seedream to image_urls + size", () => {
    expect(buildKieInput(route("unblur.std:seedream-2k:1"), input)).toEqual({
      prompt: "Restore this photo",
      image_urls: ["https://r2.example/in/x.jpg"],
      aspect_ratio: "4:3",
      size: "2K",
      output_format: "png",
    });
  });

  it("maps Nano Banana to image_input + resolution", () => {
    expect(buildKieInput(route("unblur.4k:nano-banana-pro-4k:1"), input)).toEqual({
      prompt: "Restore this photo",
      image_input: ["https://r2.example/in/x.jpg"],
      aspect_ratio: "4:3",
      resolution: "4K",
      output_format: "png",
    });
  });

  it("refuses an aspect ratio the model does not accept", () => {
    expect(() =>
      buildKieInput(route("unblur.std:seedream-2k:1"), { ...input, aspect: "5:4" }),
    ).toThrow(/5:4/);
  });
});

describe("KieAdapter.submit", () => {
  it("posts model, input and callback and returns the task id", async () => {
    const { fetch, calls } = fakeFetch({
      code: 200,
      msg: "success",
      data: { taskId: "t1", recordId: "t1" },
    });
    const kie = new KieAdapter({ apiKey: "test-key", fetch });
    const result = await kie.submit(
      route("unblur.std:seedream-2k:1"),
      input,
      "https://api.test/cb",
    );
    expect(result).toEqual({ taskId: "t1" });
    expect(calls[0]?.url).toBe(`${KIE_API}/jobs/createTask`);
    const sent = JSON.parse(String(calls[0]?.init?.body));
    expect(sent).toMatchObject({
      model: "seedream/5-flash-image-to-image",
      callBackUrl: "https://api.test/cb",
    });
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer test-key");
  });

  it("throws a classified ProviderError when kie refuses the task", async () => {
    const { fetch } = fakeFetch({ code: 422, msg: "image could not be processed", data: null });
    const kie = new KieAdapter({ apiKey: "k", fetch });
    const error = await kie
      .submit(route("unblur.std:seedream-2k:1"), input, "https://cb")
      .catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ kind: "invalid", code: 422 });
  });
});

describe("KieAdapter.status", () => {
  const success = {
    code: 200,
    data: {
      taskId: "t1",
      state: "success",
      creditsConsumed: 3.24,
      costTime: 29,
      resultJson: JSON.stringify({ resultUrls: ["https://kie.example/out.png"] }),
      response: { resultUrls: ["https://kie.example/out.png"] },
    },
  };

  it("reports pending while kie is still working", async () => {
    for (const state of ["waiting", "queuing", "generating"]) {
      const { fetch } = fakeFetch({ code: 200, data: { taskId: "t1", state } });
      expect(await new KieAdapter({ apiKey: "k", fetch }).status("t1")).toEqual({
        state: "pending",
      });
    }
  });

  it("reads the result urls, the cost in dollars and the time in ms", async () => {
    const { fetch, calls } = fakeFetch(success);
    expect(await new KieAdapter({ apiKey: "k", fetch }).status("t 1")).toEqual({
      state: "success",
      outputUrls: ["https://kie.example/out.png"],
      costUsd: 0.0162,
      costTimeMs: 29_000,
    });
    expect(calls[0]?.url).toBe(`${KIE_API}/jobs/recordInfo?taskId=t%201`);
  });

  it("falls back to resultJson when response is missing", async () => {
    const { fetch } = fakeFetch({ code: 200, data: { ...success.data, response: null } });
    const status = await new KieAdapter({ apiKey: "k", fetch }).status("t1");
    expect(status).toMatchObject({ state: "success", outputUrls: ["https://kie.example/out.png"] });
  });

  // Review focus 3: success without an image must not count as success.
  it("treats success without result urls as a failure", async () => {
    const { fetch } = fakeFetch({
      code: 200,
      data: {
        taskId: "t1",
        state: "success",
        creditsConsumed: 0,
        resultJson: "not json",
        response: null,
      },
    });
    expect(await new KieAdapter({ apiKey: "k", fetch }).status("t1")).toEqual({
      state: "fail",
      costUsd: 0,
      failCode: "NO_OUTPUT",
      failMsg: "kie reported success without result URLs",
    });
  });

  it("passes failCode and failMsg through on failure", async () => {
    const { fetch } = fakeFetch({
      code: 200,
      data: {
        taskId: "t1",
        state: "fail",
        creditsConsumed: 0,
        failCode: null,
        failMsg:
          "your content creation prompt contains NSFW, which isn't allowed under our policy.",
      },
    });
    expect(await new KieAdapter({ apiKey: "k", fetch }).status("t1")).toEqual({
      state: "fail",
      costUsd: 0,
      failMsg: "your content creation prompt contains NSFW, which isn't allowed under our policy.",
    });
  });
});

describe("review fixes", () => {
  const seedream = route("unblur.std:seedream-2k:1");

  it("wraps network failures in a provider error", async () => {
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const kie = new KieAdapter({ apiKey: "k", fetch: down });
    await expect(kie.submit(seedream, input, "https://cb")).rejects.toMatchObject({
      name: "ProviderError",
      kind: "provider_error",
      code: "NETWORK",
    });
    await expect(kie.status("t1")).rejects.toMatchObject({
      kind: "provider_error",
      code: "NETWORK",
    });
  });

  it("passes a timeout signal to every request", async () => {
    const { fetch, calls } = fakeFetch({ code: 200, data: { taskId: "t1", state: "waiting" } });
    await new KieAdapter({ apiKey: "k", fetch, requestTimeoutMs: 5000 }).status("t1");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("raises an invalid provider error for an aspect the model does not accept", () => {
    expect(() => buildKieInput(seedream, { ...input, aspect: "5:4" })).toThrow(ProviderError);
  });

  it("reads resultJson when response.resultUrls is empty", async () => {
    const { fetch } = fakeFetch({
      code: 200,
      data: {
        taskId: "t1",
        state: "success",
        creditsConsumed: 3.24,
        resultJson: JSON.stringify({ resultUrls: ["https://kie.example/out.png"] }),
        response: { resultUrls: [] },
      },
    });
    const status = await new KieAdapter({ apiKey: "k", fetch }).status("t1");
    expect(status).toMatchObject({ state: "success", outputUrls: ["https://kie.example/out.png"] });
  });
});

describe("kie balance", () => {
  it("reads the account's credits and converts them to dollars", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ code: 200, msg: "success", data: 2450 }));
    expect(await kieBalance("key", fetchImpl)).toBeCloseTo(2450 * USD_PER_KIE_CREDIT);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.kie.ai/api/v1/chat/credit",
      expect.objectContaining({ headers: { authorization: "Bearer key" } }),
    );
    await expect(
      kieBalance("key", async () => Response.json({ code: 401, msg: "bad key" })),
    ).rejects.toThrow("bad key");
  });
});
