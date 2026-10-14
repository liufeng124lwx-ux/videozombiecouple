// The zombie love story (spec §5). Keyframe prompts are image-edit instructions over the two photos;
// shot prompts animate one keyframe each. Change only together with an eval run (CLAUDE.md).
export const KINDS = ["human", "pet"] as const;
export type Kind = (typeof KINDS)[number];

export const SCENE_IDS = ["cabin-wheat", "rain-chapel", "lighthouse-beach"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export type Scene = {
  id: SceneId;
  label: string;
  /** Shown in the picker once its prompts passed the eval (spec §9). */
  live: boolean;
  /** Setting of the standoff (keyframes A, B; shots 1–3). */
  cold: string;
  /** Setting of the memory (keyframe C; shot 4). */
  warm: string;
  musicKey: string;
};

export const SCENES: Record<SceneId, Scene> = {
  "cabin-wheat": {
    id: "cabin-wheat",
    label: "Cabin → Wheat field",
    live: true,
    cold: "Inside a dim abandoned wooden cabin, cold blue moonlight through broken boards, dust in the air, 35mm film grain.",
    warm: "Golden wheat field at sunset, warm backlight, lens flare, soft haze, 35mm film grain.",
    musicKey: "music/cabin-wheat.m4a",
  },
  "rain-chapel": {
    id: "rain-chapel",
    label: "Rainy city → Chapel",
    live: false,
    cold: "Abandoned city street at night in heavy rain, wet asphalt reflecting cold blue streetlight, overturned cars, 35mm film grain.",
    warm: "Small sunlit wooden chapel decorated with white flowers, warm afternoon light through tall windows, 35mm film grain.",
    musicKey: "music/rain-chapel.m4a",
  },
  "lighthouse-beach": {
    id: "lighthouse-beach",
    label: "Lighthouse → Beach",
    live: false,
    cold: "Inside a ruined lighthouse at dusk, cold blue light, storm clouds through broken windows, 35mm film grain.",
    warm: "Sandy beach at golden hour, gentle waves, warm sunset glow, soft haze, 35mm film grain.",
    musicKey: "music/lighthouse-beach.m4a",
  },
};

export type FrameId = "A" | "B" | "C";
export type Face = "survivor" | "infected";
export type ShotId = 1 | 2 | 3 | 4;

export const REQUIRED_FACES: Record<FrameId, Face[]> = {
  A: ["infected"],
  B: ["survivor", "infected"],
  C: ["survivor", "infected"],
};

export const STORYBOARD: {
  id: ShotId;
  targetSec: number;
  first: FrameId;
  last?: FrameId;
  faces: Face[];
}[] = [
  { id: 1, targetSec: 3, first: "A", faces: ["infected"] },
  { id: 2, targetSec: 2.5, first: "A", faces: [] },
  { id: 3, targetSec: 2.5, first: "A", last: "B", faces: ["survivor", "infected"] },
  { id: 4, targetSec: 3, first: "C", faces: ["survivor", "infected"] },
];

export const CANDIDATES_PER_FRAME = 2;
export const CAPTION_SEC = 1;
export const VIDEO = { width: 720, height: 1280, fps: 24 } as const;

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";

function words(kind: Kind) {
  return kind === "human"
    ? {
        holds: "aiming a pistol",
        lowers: "slowly lowers the pistol, lets it fall",
        hands:
          "the survivor's hands on the pistol; the hands tremble and the index finger slides off the trigger",
        other: "infected partner",
        infected:
          "infected: pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing",
        healthy: "Both people healthy and smiling, clean casual clothes",
        subject2: "Person from IMAGE 2",
      }
    : {
        holds: "kneeling and holding a flashlight",
        lowers: "slowly sets the flashlight down",
        hands:
          "the survivor's hand on the flashlight; the hand trembles and slowly lowers the beam",
        other: "infected pet",
        infected: "infected: cloudy white eyes, patchy fur",
        healthy: "The person and the pet are healthy and happy",
        subject2: "The pet from IMAGE 2",
      };
}

export function keyframePrompt(sceneId: SceneId, frame: FrameId, kind: Kind): string {
  const scene = SCENES[sceneId];
  const w = words(kind);
  if (frame === "A")
    return [
      "Cinematic film still, vertical 9:16.",
      scene.cold,
      `Person from IMAGE 1 stands in the foreground, back three-quarter view, ${w.holds}, wearing a worn olive jacket.`,
      `${w.subject2} faces the camera from the far side of the room, backlit, ${w.infected} — but clearly recognizable as IMAGE 2: same face shape, features and hair or fur.`,
      "IMAGE 1 is the survivor and IMAGE 2 is the one who turned; never swap them. Keep both identities exact.",
      SAFE,
    ].join(" ");
  if (frame === "C")
    return [
      "Cinematic film still, vertical 9:16.",
      scene.warm,
      `${w.healthy}, embracing, front three-quarter view.`,
      "Person from IMAGE 1 and the subject from IMAGE 2, identities exact.",
      SAFE,
    ].join(" ");
  return [
    "Cinematic film still, vertical 9:16.",
    "IMAGE 1 is the survivor. IMAGE 2 is the one who turned. IMAGE 3 is the scene reference. IMAGE 4 is the pose reference.",
    "Use exactly the same pose, framing and camera angle as IMAGE 4.",
    "Use the setting, lighting and the infected look from IMAGE 3.",
    `Person from IMAGE 1 embraces the ${w.other} from IMAGE 2, identities exact.`,
    SAFE,
  ].join(" ");
}

export function shotPrompt(_sceneId: SceneId, shot: ShotId, kind: Kind): string {
  const w = words(kind);
  const body = {
    1: `Slow push-in from behind the survivor's shoulder. The survivor keeps ${w.holds}, trembling slightly. The ${w.other} slowly turns its head toward camera. Dust particles drift in the cold light. No lunging, no camera shake.`,
    2: `Slow push-in to a close-up of ${w.hands}. Shallow depth of field, cold blue light.`,
    3: `The survivor ${w.lowers}, and opens both arms. The ${w.other} steps forward into the embrace; they hold each other tightly. Slow orbit camera. Emotional, gentle.`,
    4: "Slow-motion pull back. They laugh while hugging, wind moves their hair. Golden hour sunlight, warm glow. Natural, joyful motion.",
  }[shot];
  return `${body} ${MOTION} ${SAFE}`;
}
