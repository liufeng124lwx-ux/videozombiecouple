import type { Grade, Kind } from "../story.ts";

export const STORY_IDS = ["zombie", "christmas"] as const;
export type StoryId = (typeof STORY_IDS)[number];

/** survivor = photo 1 (survivorKey), infected = photo 2 (infectedKey); names kept from the zombie story. */
export type Role = "survivor" | "infected";

/** Where a reference image comes from: a user photo, another keyframe of this film, or a scene asset. */
export type FrameRef = { photo: Role } | { frame: string } | { asset: string };

export type StoryKeyframe = {
  id: string;
  /** In prompt order: the first ref is IMAGE 1. A frame may only refer to keyframes listed before it. */
  refs: readonly FrameRef[];
  /** 2 or more: the candidates are scored and the best becomes the frame. */
  candidates: number;
  /** Faces compared when scoring, for people and for the pet version. */
  faces: readonly Role[];
  petFaces: readonly Role[];
  prompt(scene: string, kind: Kind): string;
};

export type StoryShot = {
  id: number;
  sec: number;
  /** clip: a finished scene video (an asset), made once per scene; no model call. */
  first: { frame: string } | { clip: string };
  last?: { frame: string };
  grade: Grade;
  /** A few white frames at the cut into this shot. */
  flash?: boolean;
  /** Absent only on clip shots. */
  prompt?(scene: string, kind: Kind): string;
};

export type StoryScene = {
  id: string;
  label: string;
  /** Orderable once its prompts passed the eval. */
  live: boolean;
  /** Key under assets/ in R2. */
  musicKey: string;
  /** Asset name → key under assets/ in R2 (images for {asset}, videos for {clip}). */
  assets: Readonly<Record<string, string>>;
};

export type StoryTitle = { line1: string; line2: string | null; line3: string | null };

export type Story = {
  id: StoryId;
  /** Credits one finished film costs. */
  credits: number;
  kinds: readonly Kind[];
  scenes: Readonly<Record<string, StoryScene>>;
  keyframes: readonly StoryKeyframe[];
  storyboard(kind: Kind): StoryShot[];
  /** Text laid over the film between start and end (seconds from the start). */
  overlays: readonly { text: string; start: number; end: number }[];
  title(v: { names: string | null; date: string | null; createdAt: number }): StoryTitle;
  /** Seconds the last frame is held after the last shot. */
  holdSec: number;
  /** Second at which the end title starts fading in; null = the composer's default. */
  titleAt: number | null;
};
