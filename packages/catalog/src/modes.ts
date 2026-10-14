export const MODE_IDS = ["auto", "motion", "focus", "portrait", "text", "old"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export type Mode = { id: ModeId; label: string; prompt: string; promptVersion: string };

/** Bump whenever any prompt text changes; the version is stored on every job (spec 3.4). */
export const PROMPT_VERSION = "2026-10-09.1";

// Same base instruction the eval used (eval/src/candidates.ts), so eval results carry over.
const BASE =
  "Restore this photo: remove the blur and make it sharp, clear and detailed, as if taken with a good camera in focus. " +
  "Keep everything else exactly the same: same framing and composition, same colors and lighting, " +
  "same people with the same identity and facial features, same objects. Do not add, remove or invent anything. Photorealistic.";

const EXTRA: Record<ModeId, string> = {
  auto: "",
  motion:
    " The blur comes from camera shake or a moving subject; remove the streaking without changing any shapes.",
  focus: " The photo is out of focus; recover fine detail and crisp edges.",
  portrait:
    " Pay special attention to faces: keep each person's identity, expression, eyes and skin texture exactly; do not beautify.",
  text: " Make every letter and number legible and keep the text exactly as written; do not change any characters.",
  old: " Also remove scratches, dust and grain. Keep the original tones (black and white or sepia); do not colorize.",
};

const LABELS: Record<ModeId, string> = {
  auto: "Auto",
  motion: "Motion",
  focus: "Focus",
  portrait: "Portrait",
  text: "Text",
  old: "Old photo",
};

export const MODES = Object.fromEntries(
  MODE_IDS.map((id) => [
    id,
    { id, label: LABELS[id], prompt: BASE + EXTRA[id], promptVersion: PROMPT_VERSION },
  ]),
) as Record<ModeId, Mode>;
