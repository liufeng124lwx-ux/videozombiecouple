import { ROUTES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { classifyKie, KieAdapter, ProviderError } from "../src/index.ts";

describe("classifyKie (spec 4.3)", () => {
  // Real failure messages seen in docs/model-eval.md runs.
  it.each([
    [
      { msg: "your content creation prompt contains NSFW, which isn't allowed under our policy." },
      "content_rejected",
    ],
    [
      { msg: "Sorry, but the image we created may violate OpenAI's content policies." },
      "content_rejected",
    ],
    [{ msg: "generate task timeout." }, "timeout"],
    [{ msg: "internal error, please try again later." }, "provider_error"],
    [{ code: 429, msg: "Too many requests" }, "rate_limited"],
    [{ code: 422, msg: "image could not be processed" }, "invalid"],
    [{ code: 400, msg: "bad aspect_ratio" }, "invalid"],
    [{ code: 455, msg: "service unavailable" }, "provider_error"],
    [{ code: 402, msg: "insufficient credits" }, "provider_error"],
    [{ code: 500, msg: "server error" }, "provider_error"],
    [{ code: "NO_OUTPUT", msg: "kie reported success without result URLs" }, "provider_error"],
    [{ code: 422, msg: "content policy violation" }, "content_rejected"],
  ] as const)("%j → %s", (fail, kind) => {
    expect(classifyKie(fail)).toBe(kind);
  });
});

// Review focus 2: kie answers HTTP 200 with an error code in the body.
describe("errors wrapped in HTTP 200", () => {
  const seedream = ROUTES.find((r) => r.id === "unblur.std:seedream-2k:1");
  if (!seedream) throw new Error("seedream route missing");
  const input = { imageUrl: "https://r2.example/in/x.jpg", prompt: "p", aspect: "1:1" };
  const answering = (body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

  it.each([
    [{ code: 429, msg: "rate limited" }, "rate_limited"],
    [{ code: 455, msg: "service unavailable" }, "provider_error"],
    [{ code: 500, msg: "boom" }, "provider_error"],
  ] as const)("submit with body %j throws %s", async (body, kind) => {
    const kie = new KieAdapter({ apiKey: "k", fetch: answering(body) });
    const error = await kie.submit(seedream, input, "https://cb").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe(kind);
  });

  it("status with a 500 body throws instead of reporting pending", async () => {
    const kie = new KieAdapter({
      apiKey: "k",
      fetch: answering({ code: 500, msg: "boom", data: null }),
    });
    await expect(kie.status("t1")).rejects.toMatchObject({ kind: "provider_error", code: 500 });
  });

  it("a non-JSON body becomes a provider error with the HTTP status", async () => {
    const html = (async () =>
      new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    const kie = new KieAdapter({ apiKey: "k", fetch: html });
    await expect(kie.status("t1")).rejects.toMatchObject({ kind: "provider_error", code: 502 });
  });

  it("tells a used-up key's daily limit apart from an outage (cost guardrails spec 6)", () => {
    expect(
      classifyKie({
        code: 433,
        msg: "The current number of points used by apiKey has exceeded the daily limit",
      }),
    ).toBe("key_daily_cap");
    // kie's code for the cap, whatever the wording of the message.
    expect(classifyKie({ code: 433, msg: "Daily quota reached" })).toBe("key_daily_cap");
    expect(classifyKie({ code: "433" })).toBe("key_daily_cap");
    expect(classifyKie({ code: 500, msg: "Internal error" })).toBe("provider_error");
  });
});
