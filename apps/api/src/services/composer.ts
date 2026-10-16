import type { Face, Grade } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** POST /score (spec §4.2 S0b, S2): identity similarity of each candidate, faces and age of the sources. */
export type ScoreRequest = {
  sources: { survivor: string; infected: string | null };
  candidates: { id: string; url: string; frame: string }[];
  requiredFaces: Record<string, Face[]>;
  checkAge: boolean;
};

export type ScoreResponse = {
  scores: Record<string, number | null>;
  sourceFaces: { survivor: boolean; infected: boolean | null };
  minAge: number | null;
};

/** POST /compose (spec §4.2 S5): the container reads and writes R2 through these signed URLs only. */
export type ComposeRequest = {
  /** anchor "end": the clip ends on a keyframe, so keep its last `seconds`. flash: white frames at the cut in. */
  shots: { url: string; seconds: number; grade: Grade; anchor: "start" | "end"; flash: boolean }[];
  musicUrl: string;
  caption: { line1: string; line2: string | null; line3: string | null };
  /** Seconds the last frame is held under the title (zombie 1, christmas 0). */
  holdSec: number;
  /** Dissolve between shots in seconds; 0 = hard cuts (zombie). */
  dissolveSec: number;
  /** When the title starts fading in; null = just before the end (the composer's default). */
  titleAt: number | null;
  overlays: { text: string; start: number; end: number }[];
  outUrl: string;
  posterUrl: string;
  /** Not used by the container; lets the in-process fake write R2 directly. */
  keys: { shots: string[]; out: string; poster: string };
};

/** The free zombie photo: stamp the AI mark; keys let the fake copy within R2. */
export type WatermarkRequest = {
  imageUrl: string;
  outUrl: string;
  keys: { image: string; out: string };
};

export interface ComposerApi {
  score(request: ScoreRequest): Promise<ScoreResponse>;
  compose(request: ComposeRequest): Promise<{ ok: true; durationSec: number }>;
  watermark(request: WatermarkRequest): Promise<{ ok: true }>;
}

/** FAKE_COMPOSER=1: no container; the first candidate of each frame wins, the video is shot 1. */
export function fakeComposer(env: Bindings): ComposerApi {
  return {
    async score(request) {
      const seen = new Set<string>();
      const scores: Record<string, number | null> = {};
      for (const c of request.candidates) {
        scores[c.id] = seen.has(c.frame) ? 0.5 : 0.6;
        seen.add(c.frame);
      }
      return {
        scores,
        sourceFaces: { survivor: true, infected: request.sources.infected ? true : null },
        minAge: 30,
      };
    },
    async compose(request) {
      const first = request.keys.shots[0];
      const shot = first ? await env.BUCKET.get(first) : null;
      if (!shot) throw new Error("fake composer: shot 1 is missing");
      const bytes = await shot.arrayBuffer();
      await env.BUCKET.put(request.keys.out, bytes, { httpMetadata: { contentType: "video/mp4" } });
      await env.BUCKET.put(request.keys.poster, bytes, {
        httpMetadata: { contentType: "image/jpeg" },
      });
      return { ok: true, durationSec: 12 };
    },
    async watermark(request) {
      const image = await env.BUCKET.get(request.keys.image);
      if (!image) throw new Error("fake composer: the photo is missing");
      await env.BUCKET.put(request.keys.out, await image.arrayBuffer(), {
        httpMetadata: { contentType: "image/jpeg" },
      });
      return { ok: true };
    },
  };
}

const SCORE_TIMEOUT_MS = 120_000;
const COMPOSE_TIMEOUT_MS = 300_000;

/** Container instances to spread stories over; matches `max_instances` in wrangler*.jsonc. */
export const COMPOSER_SHARDS = 3;

/** One story always reaches the same instance; different stories spread over all of them. */
function shardOf(storyId: string): number {
  let h = 0;
  for (const ch of storyId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % COMPOSER_SHARDS;
}

/** The container (COMPOSER binding), a local URL (COMPOSER_URL), a test double, or the fake. */
export function composerFor(env: Bindings, storyId = ""): ComposerApi {
  if (env.COMPOSER_IMPL) return env.COMPOSER_IMPL;
  if (env.FAKE_COMPOSER === "1") return fakeComposer(env);
  const call = async <T>(path: string, body: unknown, timeoutMs: number): Promise<T> => {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    };
    let response: Response;
    if (env.COMPOSER_URL) response = await fetch(`${env.COMPOSER_URL}${path}`, init);
    else if (env.COMPOSER)
      response = await env.COMPOSER.get(
        env.COMPOSER.idFromName(`composer-${shardOf(storyId)}`),
      ).fetch(`http://composer${path}`, init);
    else throw new Error("no composer configured");
    // Read every answer to the end, errors too: the container counts a request as running until
    // its body is read, and never sleeps while one runs (docs/lessons.md, container sleep).
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      throw new Error(`composer ${path}: HTTP ${response.status} ${detail}`.trim());
    }
    return (await response.json()) as T;
  };
  return {
    score: (request) => call<ScoreResponse>("/score", request, SCORE_TIMEOUT_MS),
    compose: (request) => {
      const { keys: _keys, ...body } = request;
      return call<{ ok: true; durationSec: number }>("/compose", body, COMPOSE_TIMEOUT_MS);
    },
    watermark: (request) => {
      const { keys: _keys, ...body } = request;
      return call<{ ok: true }>("/watermark", body, SCORE_TIMEOUT_MS);
    },
  };
}
