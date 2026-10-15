import { describe, expect, it } from "vitest";
import { COMPOSER_SHARDS, composerFor } from "../src/services/composer.ts";
import type { Bindings } from "../src/types.ts";

describe("composer instances", () => {
  it("spreads stories over the container instances by story id", async () => {
    const names: string[] = [];
    const env = {
      COMPOSER: {
        idFromName: (name: string) => (names.push(name), name),
        get: () => ({
          fetch: async () =>
            Response.json({
              scores: {},
              sourceFaces: { survivor: true, infected: true },
              minAge: 30,
            }),
        }),
      },
    } as unknown as Bindings;
    const ids = [
      "01AAAAAAAAAAAAAAAAAAAAAAAA",
      "01BBBBBBBBBBBBBBBBBBBBBBBB",
      "01CCCCCCCCCCCCCCCCCCCCCCCD",
      "01ZZZZZZZZZZZZZZZZZZZZZZZY",
    ];
    for (const id of ids)
      await composerFor(env, id).score({
        sources: { survivor: "s", infected: null },
        candidates: [],
        requiredFaces: { A: [], B: [], C: [] },
        checkAge: true,
      });
    expect(new Set(names).size).toBeGreaterThan(1);
    for (const n of names) expect(n).toMatch(new RegExp(`^composer-[0-${COMPOSER_SHARDS - 1}]$`));
    // The same story always reaches the same instance.
    await composerFor(env, ids[0] as string).score({
      sources: { survivor: "s", infected: null },
      candidates: [],
      requiredFaces: { A: [], B: [], C: [] },
      checkAge: true,
    });
    expect(names.at(-1)).toBe(names[0]);
  });

  it("reads every container answer to the end, errors included, so the instance can go to sleep", async () => {
    // @cloudflare/containers counts a request as running until its body is read or cancelled, and
    // never sleeps while one runs (video2mp4 kept 6 instances awake for 13 days this way).
    const answers: Response[] = [];
    const reply = (status: number, body: unknown) => {
      const response = Response.json(body, { status });
      answers.push(response);
      return response;
    };
    const queue = [
      () => reply(503, { error: "busy" }),
      () => reply(500, { error: "boom" }),
      () => reply(200, { ok: true, durationSec: 15 }),
    ];
    const env = {
      COMPOSER: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async () => (queue.shift() as () => Response)() }),
      },
    } as unknown as Bindings;
    const compose = () =>
      composerFor(env, "01AAAAAAAAAAAAAAAAAAAAAAAA").compose({
        keys: [],
      } as never);
    await expect(compose()).rejects.toThrow(/503/);
    await expect(compose()).rejects.toThrow(/500/);
    await compose();
    expect(answers).toHaveLength(3);
    for (const answer of answers) expect(answer.bodyUsed).toBe(true);
  });
});
