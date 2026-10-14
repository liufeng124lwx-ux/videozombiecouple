import { ROUTES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { FakeAdapter, ProviderError } from "../src/index.ts";

const seedream = ROUTES.find((r) => r.id === "keyframe:seedream-5-pro:3");
const nb2 = ROUTES.find((r) => r.id === "keyframe:nano-banana-2:2");
if (!seedream || !nb2) throw new Error("routes missing");
const input = { images: ["https://r2.example/in/x.jpg"], prompt: "p", aspect: "9:16" };

describe("FakeAdapter", () => {
  it("succeeds after one pending poll by default", async () => {
    const fake = new FakeAdapter();
    const { taskId } = await fake.submit(seedream, input, "https://cb");
    expect(await fake.status(taskId)).toEqual({ state: "pending" });
    expect(await fake.status(taskId)).toMatchObject({
      state: "success",
      outputUrls: ["https://fake.test/out.png"],
    });
    expect(fake.submitted).toEqual([
      { taskId, model: seedream.model, input, callbackUrl: "https://cb" },
    ]);
  });

  it("plays each model's script in order", async () => {
    const fake = new FakeAdapter({
      [seedream.model]: [
        { kind: "fail", failMsg: "your content creation prompt contains NSFW" },
        {
          kind: "success",
          pendingPolls: 0,
          outputUrl: "https://fake.test/second.png",
          costUsd: 0.0162,
        },
      ],
    });
    const first = await fake.submit(seedream, input, "https://cb");
    const second = await fake.submit(seedream, input, "https://cb");
    expect(await fake.status(first.taskId)).toEqual({
      state: "fail",
      costUsd: 0,
      failMsg: "your content creation prompt contains NSFW",
    });
    expect(await fake.status(second.taskId)).toEqual({
      state: "success",
      outputUrls: ["https://fake.test/second.png"],
      costUsd: 0.0162,
      costTimeMs: 1000,
    });
  });

  it("throws a classified error on submit when scripted", async () => {
    const fake = new FakeAdapter({
      [nb2.model]: [{ kind: "submit_error", code: 429, msg: "slow down" }],
    });
    const error = await fake.submit(nb2, input, "https://cb").catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.kind).toBe("rate_limited");
  });

  it("stays pending forever for a never step (timeouts)", async () => {
    const fake = new FakeAdapter({ [seedream.model]: [{ kind: "never" }] });
    const { taskId } = await fake.submit(seedream, input, "https://cb");
    for (let i = 0; i < 5; i++) expect(await fake.status(taskId)).toEqual({ state: "pending" });
  });

  it("rejects status for an unknown task", async () => {
    await expect(new FakeAdapter().status("nope")).rejects.toMatchObject({ kind: "invalid" });
  });
});
