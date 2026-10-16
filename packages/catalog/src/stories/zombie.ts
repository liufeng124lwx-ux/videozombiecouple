import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  type FrameId,
  keyframePrompt,
  SCENES,
  type SceneId,
  type ShotId,
  shotPrompt,
  storyboard,
} from "../story.ts";
import { TIERS } from "../tiers.ts";
import type { FrameRef, Story } from "./types.ts";

/** The end title's first line (spec §5.1). */
export const CAPTION_LINE1 = "Even at the end of the world.";

const PHOTOS: FrameRef[] = [{ photo: "survivor" }, { photo: "infected" }];
const scene = (id: string) => id as SceneId;
const frame = (id: FrameId) => (s: string, kind: Parameters<typeof keyframePrompt>[2]) =>
  keyframePrompt(scene(s), id, kind);

/** story.ts wrapped as data: same prompts, storyboard, scenes and title. */
export const ZOMBIE: Story = {
  id: "zombie",
  credits: TIERS.video.credits,
  kinds: ["human", "pet"],
  scenes: Object.fromEntries(
    Object.values(SCENES).map((s) => [
      s.id,
      { id: s.id, label: s.label, live: s.live, musicKey: s.musicKey, assets: {} },
    ]),
  ),
  keyframes: [
    {
      id: "A",
      refs: PHOTOS,
      candidates: CANDIDATES_PER_FRAME,
      faces: ["infected"],
      petFaces: [],
      prompt: frame("A"),
    },
    {
      id: "C",
      refs: PHOTOS,
      candidates: CANDIDATES_PER_FRAME,
      faces: ["survivor", "infected"],
      petFaces: ["survivor"],
      prompt: frame("C"),
    },
    {
      id: "B",
      refs: [...PHOTOS, { frame: "A" }, { frame: "C" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: ["survivor"],
      prompt: frame("B"),
    },
  ],
  storyboard: (kind) =>
    storyboard(kind).map((s) => ({
      id: s.id,
      sec: s.targetSec,
      first: { frame: s.first },
      ...(s.last ? { last: { frame: s.last } } : {}),
      grade: s.grade,
      prompt: (sc: string, k: typeof kind) => shotPrompt(scene(sc), s.id as ShotId, k),
    })),
  overlays: [],
  title: ({ names, date }) => ({
    line1: CAPTION_LINE1,
    line2: names && date ? `${names} · ${date}` : (names ?? date),
    line3: null,
  }),
  holdSec: CAPTION_SEC,
  titleAt: null,
};
