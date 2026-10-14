import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.ts";
import { createStory, getStory, recompose, render, uploadPhoto } from "./client.ts";

type Call = { url: string; init?: RequestInit | undefined };

function stubFetch(answers: { status?: number; body: unknown }[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const a = answers.shift() ?? { body: {} };
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }),
  );
  return calls;
}
const token = async () => "tok";

afterEach(() => vi.unstubAllGlobals());

describe("story client", () => {
  it("uploads a photo: ticket from the API, then a PUT straight to storage", async () => {
    const calls = stubFetch([
      {
        status: 201,
        body: {
          key: "in/K.jpg",
          url: "https://r2/put",
          method: "PUT",
          headers: { "content-type": "image/jpeg" },
          expiresInSec: 600,
        },
      },
      { body: {} },
    ]);
    const key = await uploadPhoto(new Blob(["x"], { type: "image/jpeg" }), token);
    expect(key).toBe("in/K.jpg");
    expect(calls[0]?.url).toMatch(/\/v1\/uploads$/);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      contentType: "image/jpeg",
      bytes: 1,
    });
    expect(calls[1]).toMatchObject({ url: "https://r2/put", init: { method: "PUT" } });
  });

  it("creates a story with both keys and the options", async () => {
    const calls = stubFetch([{ status: 201, body: { storyId: "S1" } }]);
    const id = await createStory(
      {
        survivorKey: "in/A.jpg",
        infectedKey: "in/B.jpg",
        kind: "human",
        scene: "cabin-wheat",
        names: "Tom & Amy",
        date: "2019",
        idempotencyKey: "k-1234567",
      },
      token,
    );
    expect(id).toBe("S1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      survivorKey: "in/A.jpg",
      infectedKey: "in/B.jpg",
      names: "Tom & Amy",
    });
  });

  it("reads a story, renders it and changes the end title", async () => {
    const calls = stubFetch([
      { body: { id: "S1", status: "preview_ready" } },
      { status: 202, body: { ok: true } },
      { status: 202, body: { ok: true } },
    ]);
    expect((await getStory("S1")).status).toBe("preview_ready");
    await render("S1", "render-key-1", token);
    await recompose("S1", { names: "A", date: "B" });
    expect(calls.map((c) => c.url.replace(/^.*\/v1/, "/v1"))).toEqual([
      "/v1/stories/S1",
      "/v1/stories/S1/render",
      "/v1/stories/S1/recompose",
    ]);
  });

  it("turns API errors into ApiError codes", async () => {
    stubFetch([{ status: 402, body: { error: { code: "CREDITS_LOW" } } }]);
    await expect(render("S1", "render-key-1", token)).rejects.toEqual(new ApiError("CREDITS_LOW"));
  });
});
