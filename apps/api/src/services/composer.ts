import type { Face, FrameId } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** POST /score (spec §4.2 S0b, S2): identity similarity of each candidate, faces and age of the sources. */
export type ScoreRequest = {
  sources: { survivor: string; infected: string | null };
  candidates: { id: string; url: string; frame: FrameId }[];
  requiredFaces: Record<FrameId, Face[]>;
  checkAge: boolean;
};

export type ScoreResponse = {
  scores: Record<string, number | null>;
  sourceFaces: { survivor: boolean; infected: boolean | null };
  minAge: number | null;
};

/** POST /compose (spec §4.2 S5): the container reads and writes R2 through these signed URLs only. */
export type ComposeRequest = {
  shots: { url: string; seconds: number; grade: "cold" | "warm" }[];
  musicUrl: string;
  caption: { line1: string; line2: string | null };
  outUrl: string;
  posterUrl: string;
  /** Not used by the container; lets the in-process fake write R2 directly. */
  keys: { shots: string[]; out: string; poster: string };
};

export interface ComposerApi {
  score(request: ScoreRequest): Promise<ScoreResponse>;
  compose(request: ComposeRequest): Promise<{ ok: true; durationSec: number }>;
}

/** FAKE_COMPOSER=1: no container; the first candidate of each frame wins, the video is shot 1. */
export function fakeComposer(env: Bindings): ComposerApi {
  return {
    async score(request) {
      const seen = new Set<FrameId>();
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
  };
}

const SCORE_TIMEOUT_MS = 120_000;
const COMPOSE_TIMEOUT_MS = 300_000;

/** The container (COMPOSER binding), a local URL (COMPOSER_URL), a test double, or the fake. */
export function composerFor(env: Bindings): ComposerApi {
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
      response = await env.COMPOSER.get(env.COMPOSER.idFromName("composer")).fetch(
        `http://composer${path}`,
        init,
      );
    else throw new Error("no composer configured");
    if (!response.ok) throw new Error(`composer ${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  return {
    score: (request) => call<ScoreResponse>("/score", request, SCORE_TIMEOUT_MS),
    compose: (request) => {
      const { keys: _keys, ...body } = request;
      return call<{ ok: true; durationSec: number }>("/compose", body, COMPOSE_TIMEOUT_MS);
    },
  };
}
