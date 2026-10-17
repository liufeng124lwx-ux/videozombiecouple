import { fact, STORIES, type StoryId } from "@vzc/catalog";
import type { MessageKey } from "@vzc/i18n";
import {
  filmMemory,
  filmPoster,
  HERO_PAIR,
  SAMPLE_FILMS,
  type SampleFilm,
  sampleFile,
  samplePair,
} from "./samples.ts";

/**
 * What a story's landing page shows (showcase spec §5): its sample films, its hero film and the
 * beats of the film, all read from the catalog and lib/samples.ts.
 */

/** Which storyboard shots make up each beat on the page; the zombie story keeps its own section. */
const BEAT_SHOTS: Partial<Record<StoryId, readonly (readonly number[])[]>> = {
  // The stranger (cold) · the ornament and the lights · remembering, the memory and dawn.
  christmas: [
    [1, 2, 3],
    [4, 5],
    [6, 7, 8, 9],
  ],
};

export type StoryBeat = {
  /** Seconds from the start of the film. */
  start: number;
  end: number;
  shots: number[];
  /** The film's own on-screen lines that appear during the beat. */
  lines: string[];
};

export function storyBeats(story: StoryId): StoryBeat[] {
  const groups = BEAT_SHOTS[story];
  if (!groups) return [];
  const s = STORIES[story];
  const shots = s.storyboard(s.kinds[0] ?? "human");
  let at = 0;
  const beats = groups.map((ids, i) => {
    const start = at;
    at += shots.filter((shot) => ids.includes(shot.id)).reduce((t, shot) => t + shot.sec, 0);
    // The held last frame belongs to the last beat.
    if (i === groups.length - 1) at += s.holdSec;
    return { start, end: at, shots: [...ids], lines: [] as string[] };
  });
  for (const overlay of s.overlays)
    beats.find((b) => overlay.start >= b.start && overlay.start < b.end)?.lines.push(overlay.text);
  return beats;
}

/** 75 → "1:15". */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Every sample film of a story, in SAMPLE_FILMS order. */
export function storyFilms(story: StoryId): SampleFilm[] {
  return SAMPLE_FILMS.filter((f) => f.story === story);
}

/** The films whose posters and loops the tool's scene picker shows. */
export function toolFilms(story: StoryId): SampleFilm[] {
  return storyFilms(story).filter((f) => f.kind === "human");
}

export type StorySample = { film: SampleFilm; scene: string; alt: string };

/** One sample per scene, labelled as an AI example of its eval persona (spec §6). */
export function storySamples(story: StoryId): StorySample[] {
  return toolFilms(story).map((film) => {
    const scene = STORIES[story].scenes[film.scene]?.label ?? film.scene;
    const who = samplePair(film.pair)?.who;
    if (!who) throw new Error(`sample film ${film.id} has no pair ${film.pair}`);
    const older = story === "christmas" ? `, ${fact("story.christmas.years")} years on` : "";
    return { film, scene, alt: `AI example: ${who}${older} (${scene.toLowerCase()})` };
  });
}

/** The hero film: the one the page names (any story), else the story's first; unknown ids throw. */
export function heroFilm(id: string | undefined, story: StoryId): SampleFilm {
  const film = id === undefined ? storyFilms(story)[0] : SAMPLE_FILMS.find((f) => f.id === id);
  if (!film) throw new Error(`Unknown sample film "${id ?? `first ${story} film`}"`);
  return film;
}

/** The share image's two frames (cold, warm) and their labels: the story's own film when it has one. */
export function ogFrames(story: StoryId): {
  sample: { before: string; after: string };
  labels: { before: MessageKey; after: MessageKey };
} {
  if (story === "zombie")
    return {
      sample: { before: sampleFile(HERO_PAIR, "A"), after: sampleFile(HERO_PAIR, "C") },
      labels: { before: "og.before", after: "og.after" },
    };
  const film = heroFilm(undefined, story);
  return {
    sample: { before: filmPoster(film.id), after: filmMemory(film.id) },
    labels: { before: "christmas.og.before", after: "christmas.og.after" },
  };
}
