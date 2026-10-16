import type { Kind } from "../story.ts";
import type { FrameRef, Story, StoryScene } from "./types.ts";

// Spec 2026-10-15-christmas-story-design.md §2–§3. First drafts: tuned in 即梦 before they go live.
// survivor = the one who remembers (photo 1), infected = the one who forgets (photo 2).

type Setting = { now: string; memory: string; window: string };

const SETTINGS: Record<string, Setting & { label: string }> = {
  "snow-cabin": {
    label: "Snowy cabin",
    now: "a small wooden cabin living room on Christmas Eve, lamps off, cold blue moonlight from the snow outside through a frosted window, an unlit Christmas tree with a few old ornaments, an armchair by the window",
    memory:
      "a tiny first apartment on a golden winter afternoon, moving boxes against the wall, a one-metre Christmas tree, two new white enamel mugs on the windowsill",
    window: "a snow-covered wooden cabin at night",
  },
  "city-flat": {
    label: "Old city flat",
    now: "an old city apartment living room on Christmas Eve, lamps off, cold blue light from the snowy street through a tall frosted window, an unlit Christmas tree, an armchair by the window",
    memory:
      "a Christmas market at golden hour, string lights, wooden stalls, a small tree on a stall table",
    window: "an old brick apartment building on a snowy city street at night",
  },
  farmhouse: {
    label: "Farmhouse",
    now: "a farmhouse living room on Christmas Eve, lamps off, cold blue light from the snowy fields through a frosted window, an unlit Christmas tree, an armchair by the window",
    memory:
      "a snowy field on a golden afternoon, the young couple beside a small freshly cut Christmas tree",
    window: "a farmhouse alone in snowy fields at night",
  },
};

const asset = (scene: string, name: string) => `stories/christmas/${scene}/${name}`;

const SCENES: Record<string, StoryScene> = Object.fromEntries(
  Object.entries(SETTINGS).map(([id, s]) => [
    id,
    {
      id,
      label: s.label,
      live: false,
      musicKey: asset(id, "music.m4a"),
      assets: {
        ornament: asset(id, "ornament.jpg"),
        hands: asset(id, "hands.mp4"),
        window: asset(id, "window.mp4"),
      },
    },
  ]),
);

const STYLE = "Cinematic film still, vertical 9:16, 35mm film grain.";
const SAFE = "No text, no glasses, no exaggerated crying, no distorted hands.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";
const ORNAMENT = "the red glass heart ornament with a gold ribbon";
const AGED = (n: number) =>
  `aged to about 78, silver-white hair, deep wrinkles at the eyes and forehead, age spots on the hands — but the exact same face shape, features and hairline as IMAGE ${n}, instantly recognizable as the same person`;
const FORGETS_CLOTHES = "a cream cable-knit cardigan, a red and green plaid blanket on the lap";
const REMEMBERS_CLOTHES = "a navy wool sweater over a light shirt collar";

const PHOTOS: FrameRef[] = [{ photo: "survivor" }, { photo: "infected" }];
const s = (scene: string) => {
  const found = SETTINGS[scene];
  if (!found) throw new Error(`unknown christmas scene ${scene}`);
  return found;
};

export const CHRISTMAS: Story = {
  id: "christmas",
  credits: 20,
  kinds: ["human"],
  scenes: SCENES,
  keyframes: [
    {
      id: "wide",
      refs: PHOTOS,
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene) =>
        [
          STYLE,
          `${s(scene).now}.`,
          `The person from IMAGE 2, ${AGED(2)}, sits in the armchair by the window in profile, wearing ${FORGETS_CLOTHES}, looking out at the snow.`,
          `The person from IMAGE 1, ${AGED(1)}, stands in the doorway holding two white enamel mugs with chipped rims, wearing ${REMEMBERS_CLOTHES}.`,
          "Wide shot, both faces clearly visible. Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "memory",
      refs: [...PHOTOS, { asset: "ornament" }],
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene) =>
        [
          STYLE,
          `${s(scene).memory}, warm golden light, soft haze.`,
          "The person from IMAGE 2, exactly as they look in IMAGE 2, wearing a burgundy sweater, rests one hand on the cheek of the person from IMAGE 1, exactly as they look in IMAGE 1, wearing a grey hoodie; both laughing, faces close.",
          `${ORNAMENT} exactly as in IMAGE 3 hangs on the small tree beside them.`,
          "Medium close-up, front three-quarter view.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetCold",
      refs: [{ photo: "infected" }, { frame: "wide" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: (scene) =>
        [
          STYLE,
          `Close-up of the person sitting by the window in IMAGE 2, ${AGED(1)}, same clothes, light and room as IMAGE 2 (${s(scene).now}).`,
          "Cold blue window light from the side, the face filling two thirds of the frame, eyes looking out of the window, a distant, empty gaze.",
          "Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "rememberClose",
      refs: [{ photo: "survivor" }, { frame: "wide" }],
      candidates: 1,
      faces: ["survivor"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          `Close-up of the person standing in the doorway in IMAGE 2, ${AGED(1)}, same clothes and light as IMAGE 2.`,
          "The dark, unlit Christmas tree blurred behind; cold shadows; a glint of moisture in the eyes, a small, sad smile.",
          SAFE,
        ].join(" "),
    },
    {
      id: "tree",
      refs: [...PHOTOS, { frame: "wide" }, { asset: "ornament" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          "The same room, people, clothes and cold light as IMAGE 3.",
          `The person from IMAGE 1, ${AGED(1)}, stands in profile at the unlit Christmas tree, raising ${ORNAMENT} exactly as in IMAGE 4 to a branch at eye level.`,
          `In the soft-focus background, the person from IMAGE 2, ${AGED(2)}, sits in the armchair by the window.`,
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetWarm",
      refs: [{ photo: "infected" }, { frame: "forgetCold" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          `Exactly the same framing, person, ${AGED(1)}, and clothes as IMAGE 2, but now lit by warm amber Christmas-tree lights.`,
          "The eyes have come into focus and look just off camera at someone they love; tears welling but not falling, lips slightly parted.",
          SAFE,
        ].join(" "),
    },
    {
      id: "embrace",
      refs: [...PHOTOS, { frame: "tree" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          "The same room and clothes as IMAGE 3, the Christmas tree now fully lit with warm amber lights, pale dawn at the window, snow still falling.",
          `The person from IMAGE 1, ${AGED(1)}, and the person from IMAGE 2, ${AGED(2)}, stand by the tree, foreheads touching, eyes closed, one hand of the person from IMAGE 2 resting on the other's cheek.`,
          "Medium shot.",
          SAFE,
        ].join(" "),
    },
  ],
  storyboard: (_kind: Kind) => [
    {
      id: 1,
      sec: 3,
      first: { frame: "forgetCold" },
      grade: "cold",
      prompt: () =>
        `The person turns their head toward someone just off camera, gives a small polite smile, the kind you give a stranger, then turns back to the window, the gaze empty again. Static camera. ${MOTION}`,
    },
    {
      id: 2,
      sec: 3,
      first: { frame: "rememberClose" },
      grade: "cold",
      prompt: () =>
        `The person's smile falters, the eyes grow wet without tears falling, and they slowly lower their head. Very slow push-in. ${MOTION}`,
    },
    {
      id: 3,
      sec: 4,
      first: { frame: "wide" },
      grade: "cold",
      prompt: () =>
        `The person in the doorway walks slowly to the armchair and gently sets one mug on the small table beside the seated person; steam rises. The seated person keeps looking out of the window. Then the standing person turns to look at the dark Christmas tree. Static camera, slight push-in. ${MOTION}`,
    },
    { id: 4, sec: 3, first: { clip: "hands" }, grade: "cold" },
    {
      id: 5,
      sec: 4,
      first: { frame: "tree" },
      grade: "cold",
      prompt: () =>
        `The ornament is hung on the branch and sways gently. The tree's lights switch on one by one, spreading outward from the ornament, until warm amber light reaches the person in the armchair. Slow lateral camera move from the tree to the armchair. ${MOTION}`,
    },
    {
      id: 6,
      sec: 3,
      first: { frame: "forgetWarm" },
      grade: "amber",
      prompt: () =>
        `The gaze slowly focuses with recognition, tears well up, the lips tremble slightly, and one hand rises out of frame toward the face of the person they love. Static camera. ${MOTION}`,
    },
    {
      id: 7,
      sec: 4,
      first: { frame: "memory" },
      grade: "golden",
      flash: true,
      prompt: () =>
        `Both laugh; the one with the hand on the other's cheek leans in and is kissed on the forehead, eyes closing with a smile. Gentle handheld feel, slow pull back, like a home video. ${MOTION}`,
    },
    {
      id: 8,
      sec: 4,
      first: { frame: "embrace" },
      grade: "amber-dawn",
      prompt: () =>
        `Foreheads touching, eyes closed, they sway slowly from side to side as if dancing. Outside the window the sky turns from blue to pale white. The camera slowly pulls back and rises, revealing the lit tree and two steaming mugs on the windowsill. ${MOTION}`,
    },
    { id: 9, sec: 4, first: { clip: "window" }, grade: "amber-dawn" },
  ],
  overlays: [
    { text: "Our 50th Christmas. Today, you asked me my name.", start: 0, end: 5 },
    { text: "So I brought back our first one.", start: 10, end: 13 },
  ],
  title: ({ names, date, createdAt }) => {
    const year = date?.match(/\b(\d{4})\b/)?.[1] ?? String(new Date(createdAt).getUTCFullYear());
    return {
      line1: `Our first Christmas · ${year}`,
      line2: "and every one after.",
      line3: names,
    };
  },
  holdSec: 0,
  titleAt: 30,
};
