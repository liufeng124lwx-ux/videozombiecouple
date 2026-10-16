import type { Kind } from "../story.ts";
import { type Appearance, EMPTY_APPEARANCE } from "./appearance.ts";
import type { FrameRef, Story, StoryScene } from "./types.ts";

// Spec 2026-10-15-christmas-story-design.md §2–§3. First drafts: tuned in 即梦 before they go live.
// survivor = the one who remembers (photo 1), infected = the one who forgets (photo 2).

// `room`: the dark living room without the armchair (close-ups); `now` adds it (wide shot).
type Setting = { room: string; memory: string; window: string };
const ARMCHAIR = "an armchair facing the window with its back to the doorway";

const SETTINGS: Record<string, Setting & { label: string }> = {
  "snow-cabin": {
    label: "Snowy cabin",
    room: "a small wooden cabin living room on Christmas Eve, lamps off, cold blue moonlight from the snow outside through a frosted window, an unlit Christmas tree with a few old ornaments",
    memory:
      "a tiny first apartment on a golden winter afternoon, moving boxes against the wall, a one-metre Christmas tree, two new white enamel mugs on the windowsill",
    window: "a snow-covered wooden cabin at night",
  },
  "city-flat": {
    label: "Old city flat",
    room: "an old city apartment living room on Christmas Eve, lamps off, cold blue light from the snowy street through a tall frosted window, an unlit Christmas tree",
    memory:
      "a Christmas market at golden hour, string lights, wooden stalls, a small tree on a stall table",
    window: "an old brick apartment building on a snowy city street at night",
  },
  farmhouse: {
    label: "Farmhouse",
    room: "a farmhouse living room on Christmas Eve, lamps off, cold blue light from the snowy fields through a frosted window, an unlit Christmas tree",
    memory:
      "a snowy field on a golden afternoon, the young couple beside a small freshly cut Christmas tree",
    window: "a farmhouse alone in snowy fields at night",
  },
};

const shared = (name: string) => `stories/christmas/shared/${name}`;
const asset = (scene: string, name: string) => `stories/christmas/${scene}/${name}`;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const SCENES: Record<string, StoryScene> = Object.fromEntries(
  Object.entries(SETTINGS).map(([id, s]) => [
    id,
    {
      id,
      label: s.label,
      live: false,
      musicKey: asset(id, "music.m4a"),
      assets: {
        ornament: shared("ornament.jpg"),
        hands: shared("hands.mp4"),
        window: asset(id, "window.mp4"),
      },
    },
  ]),
);

const STYLE = "Cinematic film still, vertical 9:16, 35mm film grain.";
// Glasses: only an appearance line speaks of them (a "no glasses" here would contradict it).
const SAFE = "No text, no exaggerated crying, no distorted hands.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";
const ORNAMENT = "the red glass heart ornament with a gold ribbon";
const OLD =
  "in their late seventies, unmistakably elderly: deep wrinkles across the forehead and around the eyes and mouth, sagging skin, age spots, thin hands";
const SKIN = (n: number) =>
  `the skin exactly as dark or as light as in IMAGE ${n}, never lighter or darker`;
const SAME = (n: number) =>
  `keeping the exact face shape, features and gender of IMAGE ${n} and ${SKIN(n)}, instantly recognizable as the same person fifty years older`;

// A sentence of its own, placed right after the person's main sentence. Empty line: no sentence.
export const APPEARANCE_MARK = "Visible features of the person from IMAGE";
const AGED = (n: number, line: string) =>
  line
    ? ` ${APPEARANCE_MARK} ${n}, now fifty years older with any visible hair or beard turned white or silver: ${line}.`
    : "";
const YOUNG = (n: number, line: string) => (line ? ` ${APPEARANCE_MARK} ${n}: ${line}.` : "");
const ONE_ORNAMENT = "only this one heart ornament on the tree";

type Look = Appearance | undefined;
const l = (look: Look) => look ?? EMPTY_APPEARANCE;
const FORGETS_CLOTHES = "a cream cable-knit cardigan, a red and green plaid blanket on the lap";
const REMEMBERS_CLOTHES = "a navy wool sweater over a light shirt collar";

const PHOTOS: FrameRef[] = [{ photo: "survivor" }, { photo: "infected" }];
const s = (scene: string) => {
  const found = SETTINGS[scene];
  if (!found) throw new Error(`unknown christmas scene ${scene}`);
  return { ...found, now: `${found.room}, ${ARMCHAIR}` };
};

export const CHRISTMAS: Story = {
  id: "christmas",
  credits: 20,
  kinds: ["human"],
  describe: true,
  scenes: SCENES,
  keyframes: [
    {
      id: "wide",
      refs: PHOTOS,
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `${capital(s(scene).now)}.`,
          `The person from IMAGE 2 sits in the armchair facing the window, their back to the doorway, seen in profile from the side, wearing ${FORGETS_CLOTHES}, eyes fixed on the snow outside the window; they are ${OLD}, ${SAME(2)}.${AGED(2, l(look).infected)}`,
          `The person from IMAGE 1 stands in the doorway behind the armchair, unseen by the seated person, holding two white enamel mugs with chipped rims, wearing ${REMEMBERS_CLOTHES}; they are ${OLD}, ${SAME(1)}.${AGED(1, l(look).survivor)}`,
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
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `${capital(s(scene).memory)}, warm golden light, soft haze, slightly overexposed like an old home movie.`,
          `The person from IMAGE 2, wearing a burgundy sweater, rests one hand on the cheek of the person from IMAGE 1, wearing a grey hoodie; both laughing, faces close.${YOUNG(2, l(look).infected)}${YOUNG(1, l(look).survivor)} Each person keeps the face, hair, age, skin tone and gender of their own photo exactly.`,
          `${capital(ORNAMENT)} exactly as in IMAGE 3 hangs on the small tree beside them.`,
          "Medium close-up, front three-quarter view, both faces clearly visible. Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetCold",
      refs: [{ photo: "infected" }],
      candidates: 2,
      faces: ["infected"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `Tight head-and-shoulders close-up of the person in IMAGE 1, ${OLD}, ${SAME(1)}.${AGED(1, l(look).infected)}`,
          `Wearing ${FORGETS_CLOTHES.split(",")[0]}. Sitting by the frosted window of ${s(scene).room}; cold blue moonlight on one side of the face, the unlit Christmas tree blurred behind.`,
          "Eyes looking out of the window, a distant, empty gaze. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "rememberClose",
      refs: [{ photo: "survivor" }],
      candidates: 2,
      faces: ["survivor"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `Tight head-and-shoulders close-up of the person in IMAGE 1, ${OLD}, ${SAME(1)}.${AGED(1, l(look).survivor)}`,
          `Wearing ${REMEMBERS_CLOTHES}. Standing in the dark doorway of ${s(scene).room}; cold blue shadows, the unlit Christmas tree blurred behind.`,
          "A glint of moisture in the eyes, a small, sad smile. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "tree",
      refs: [...PHOTOS, { frame: "wide" }, { asset: "ornament" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          "The same room, the same two elderly people, the same clothes and the same cold blue moonlight as IMAGE 3.",
          `In the foreground, the person standing in IMAGE 3, in the navy wool sweater, with the face of IMAGE 1 grown old, the same gender as IMAGE 1 and ${SKIN(1)}, stands in profile at the unlit Christmas tree, raising ${ORNAMENT} exactly as in IMAGE 4 to a branch at eye level; ${ONE_ORNAMENT}.${AGED(1, l(look).survivor)}`,
          `In the soft-focus background, the person sitting in the armchair in IMAGE 3, in the cream cardigan, with the face of IMAGE 2 grown old, the same gender as IMAGE 2 and ${SKIN(2)}.${AGED(2, l(look).infected)}`,
          "Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetWarm",
      refs: [{ photo: "infected" }, { frame: "forgetCold" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          `Exactly the same framing, person, face, clothes and room as IMAGE 2 — the person from IMAGE 1 grown old, the same gender as IMAGE 1 and ${SKIN(1)} — but now lit by warm amber Christmas-tree lights from the side instead of cold moonlight.${AGED(1, l(look).infected)}`,
          "The eyes have come into focus and look just off camera at someone they love; tears welling but not falling, lips slightly parted. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "embrace",
      refs: [...PHOTOS, { frame: "tree" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          `The same room, the same two elderly people and the same clothes as IMAGE 3, but the Christmas tree is now fully lit with warm amber lights, ${ONE_ORNAMENT}; pale dawn light at the frosted window, snow still falling.`,
          `They stand by the lit tree, foreheads touching, eyes closed, gentle smiles: the one in the navy sweater has the face of IMAGE 1 grown old, the same gender as IMAGE 1 and ${SKIN(1)}; the one in the cream cardigan has the face of IMAGE 2 grown old, the same gender as IMAGE 2 and ${SKIN(2)}; one hand rests on the other's cheek.${AGED(1, l(look).survivor)}${AGED(2, l(look).infected)}`,
          "Medium shot, both faces in profile, clearly recognizable. Never swap the two people.",
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
