// Storyboard for the cabin → wheat field scene (spec §5). Prompts are drafts until the eval confirms them.
import type { Kind } from "./personas.ts";

export type FrameId = "A" | "B" | "C";
export type ShotDef = { id: 1 | 2 | 3 | 4; targetSec: number; first: FrameId; last?: FrameId };

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";
const CABIN = "Inside a dim abandoned wooden cabin, cold blue moonlight through broken boards, dust in the air, 35mm film grain.";
const FIELD = "Golden wheat field at sunset, warm backlight, lens flare, soft haze, 35mm film grain.";

// Which identities must be recognisable in each keyframe (used by face_score.py too).
export const REQUIRED_FACES: Record<FrameId, ("survivor" | "infected")[]> = {
  A: ["infected"],
  B: ["survivor", "infected"],
  C: ["survivor", "infected"],
};

function words(kind: Kind) {
  return kind === "human"
    ? {
        holds: "aiming a pistol",
        lowers: "slowly lowers the pistol, lets it fall",
        hands: "the survivor's hands on the pistol; the hands tremble and the index finger slides off the trigger",
        other: "infected partner",
        infected: "infected: pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing",
        healthy: "Both people healthy and smiling, clean casual clothes",
      }
    : {
        holds: "kneeling and holding a flashlight",
        lowers: "slowly sets the flashlight down",
        hands: "the survivor's hand on the flashlight; the hand trembles and slowly lowers the beam",
        other: "infected pet",
        infected: "infected: cloudy white eyes, patchy fur",
        healthy: "The person and the pet are healthy and happy",
      };
}

export function keyframePrompt(frame: FrameId, kind: Kind): string {
  const w = words(kind);
  const subject2 = kind === "human" ? "Person from IMAGE 2" : "The pet from IMAGE 2";
  if (frame === "A") {
    return [
      "Cinematic film still, vertical 9:16.",
      CABIN,
      `Person from IMAGE 1 stands in the foreground, back three-quarter view, ${w.holds}, wearing a worn olive jacket.`,
      `${subject2} is in the doorway, backlit, ${w.infected} — but clearly recognizable as IMAGE 2: same face shape, features and hair or fur.`,
      "Keep both identities exact.",
      SAFE,
    ].join(" ");
  }
  if (frame === "C") {
    return [
      "Cinematic film still, vertical 9:16.",
      FIELD,
      `${w.healthy}, embracing, front three-quarter view.`,
      "Person from IMAGE 1 and the subject from IMAGE 2, identities exact.",
      SAFE,
    ].join(" ");
  }
  return [
    "Cinematic film still, vertical 9:16.",
    "IMAGE 1 is the survivor. IMAGE 2 is the one who turned. IMAGE 3 is the scene reference. IMAGE 4 is the pose reference.",
    "Use exactly the same pose, framing and camera angle as IMAGE 4.",
    "Use the cabin, lighting and the infected look from IMAGE 3.",
    `Person from IMAGE 1 embraces the ${w.other} from IMAGE 2, identities exact.`,
    SAFE,
  ].join(" ");
}

export const SHOTS: ShotDef[] = [
  { id: 1, targetSec: 3, first: "A" },
  { id: 2, targetSec: 2.5, first: "A" },
  { id: 3, targetSec: 2.5, first: "A", last: "B" },
  { id: 4, targetSec: 3, first: "C" },
];

export function shotPrompt(id: ShotDef["id"], kind: Kind): string {
  const w = words(kind);
  const body = {
    1: `Slow push-in from behind the survivor's shoulder. The survivor keeps ${w.holds}, trembling slightly. The ${w.other} slowly turns its head toward camera. Dust particles drift in moonlight. No lunging, no camera shake.`,
    2: `Slow push-in to a close-up of ${w.hands}. Shallow depth of field, cold blue moonlight.`,
    3: `The survivor ${w.lowers}, and opens both arms. The ${w.other} steps forward into the embrace; they hold each other tightly. Slow orbit camera. Emotional, gentle.`,
    4: "Slow-motion pull back. They laugh while hugging, wind moves their hair and the wheat. Golden hour sunlight, warm glow. Natural, joyful motion.",
  }[id];
  return `${body} ${MOTION} ${SAFE}`;
}
