/**
 * What the describe step read from each photo (christmas content spec §2.3): head covering, hair,
 * facial hair, glasses. survivor = photo 1, infected = photo 2. "" = nothing usable.
 * Never stored outside the story's own Durable Object state (spec §7).
 */
export type Appearance = { survivor: string; infected: string };

export const EMPTY_APPEARANCE: Appearance = { survivor: "", infected: "" };

export const APPEARANCE_MAX_CHARS = 120;

/** Sent with the two photos to the describe route (christmas content spec §2.3). */
export const DESCRIBE_PROMPT = [
  "You will see two photos, IMAGE 1 and IMAGE 2, each of one person.",
  "For each photo, list only what is visible on the head and face: head covering (colour, pattern, how much hair it covers) or none, hair (length, colour, style, or bald), facial hair, glasses.",
  "Never mention age, religion, ethnicity, nationality, skin colour, health, disability or body shape. Do not guess anything that is not visible.",
  "Answer with exactly two lines and nothing else:",
  "IMAGE 1: <comma-separated visible features>",
  "IMAGE 2: <comma-separated visible features>",
].join("\n");

const RENAME: readonly [RegExp, string][] = [
  [
    /\b(hijab|niqab|khimar|chador|burqa|al-amira|keffiyeh|tichel|dupatta|shemagh|ghutra)\b/gi,
    "headscarf",
  ],
  [/\b(turban|dastar|pagri|keski)\b/gi, "head wrap"],
  [/\b(kippah|kippa|yarmulke|kufi|taqiyah)\b/gi, "small cap"],
];

/** Inferences the line must never carry; hair colours like "white hair" are allowed. */
const BANNED =
  /\b(muslim|islam\w*|christian\w*|catholic|jewish|jew|sikh\w*|hindu\w*|buddhis\w*|religio\w*|arab\w*|asian|african|caucasian|latin[oa]|latinx|hispanic|indian|ethnic\w*|race|racial|nationality|american|european|chinese|japanese|korean|mexican|disab\w*|wheelchair|ill(ness)?|disease|sick|pregnan\w*|years?\s+old|\d+\s*(years?|yrs?)|elderly|teen\w*|child)\b/i;

const words = (list: string) => list.split(/\s+/).filter(Boolean);

const COLOURS = words(
  "black brown dark light blond blonde red ginger auburn grey gray white silver golden sandy chestnut salt-and-pepper blue navy green pink purple yellow orange beige cream maroon burgundy patterned floral striped plain",
);
const SHAPES = words(
  "short long medium medium-length shoulder-length chin-length cropped very full thick thin thinning receding wavy curly coily straight messy tousled neat slicked slicked-back back tied loose side parted swept layered natural spiky",
);
const NOUNS = words(
  "hair hairline bald head shaved buzz crew cut bob pixie fringe bangs curls braid braids braided plait plaits ponytail bun top knot afro dreadlocks locs cornrows mohawk undercut headscarf wrap scarf hood hat cap beanie headband bandana beard stubble moustache mustache goatee sideburns clean-shaven glasses sunglasses spectacles frames rimmed round rectangular thin-rimmed thick-rimmed small",
);
const CONNECTIVES = words("a an the and with no covering covers all most in up pulled");

/** An item survives only if every word is on the head/face vocabulary (BANNED is a second gate). */
const VOCABULARY = new Set([...COLOURS, ...SHAPES, ...NOUNS, ...CONNECTIVES]);
const NOUN_SET = new Set(NOUNS);
const MAX_ITEM_WORDS = 8;

function allowedItem(item: string): boolean {
  if (!/^[a-z-]+( [a-z-]+)*$/.test(item) || item.includes("-style")) return false;
  const tokens = item.split(" ");
  return (
    tokens.length <= MAX_ITEM_WORDS &&
    tokens.every((t) => VOCABULARY.has(t)) &&
    tokens.some((t) => NOUN_SET.has(t))
  );
}

function clean(line: string): string {
  let out = line
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .replace(/[\p{Z}\s]+/gu, " ")
    .trim();
  for (const [pattern, word] of RENAME) out = out.replace(pattern, word);
  const items = out
    .split(",")
    .map((item) =>
      item
        .toLowerCase()
        .trim()
        .split(" ")
        .filter((w, i, all) => w !== all[i - 1])
        .join(" "),
    )
    .filter((item) => allowedItem(item) && !BANNED.test(item));
  while (items.length > 1 && items.join(", ").length > APPEARANCE_MAX_CHARS) items.pop();
  out = items.join(", ");
  return out.length > APPEARANCE_MAX_CHARS ? "" : out;
}

/** The model's answer → one safe line per photo; anything unusable becomes "". */
export function parseAppearance(text: string): Appearance {
  const found: Record<"1" | "2", string | undefined> = { "1": undefined, "2": undefined };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*•]?\s*image\s*([12])\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1] as "1" | "2";
    if (found[key] === undefined) found[key] = clean(m[2] as string);
  }
  return { survivor: found["1"] ?? "", infected: found["2"] ?? "" };
}
