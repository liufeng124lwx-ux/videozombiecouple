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
  "For each photo, list only what is visible on the head and face, as short noun phrases: head covering (colour, pattern, how much hair it covers) or none, hair (length, colour, style, or bald), facial hair, glasses.",
  'Call any scarf or wrap worn over the hair a "headscarf", and any brimmed or fitted head covering a "hat" or a "cap".',
  "Never mention age, religion, ethnicity, nationality, skin colour, health, disability or body shape. Do not guess anything that is not visible.",
  "Answer with exactly two lines and nothing else:",
  "IMAGE 1: <comma-separated visible features>",
  "IMAGE 2: <comma-separated visible features>",
  "Example line:",
  "IMAGE 1: blue patterned headscarf covering all hair, short dark beard, no glasses",
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
  "black brown dark light blond blonde red ginger auburn grey gray greying graying white silver golden sandy chestnut salt-and-pepper blue navy green pink purple yellow orange beige cream maroon burgundy patterned pattern floral striped plain",
);
const SHAPES = words(
  "short long medium medium-length shoulder-length chin-length chest-length waist-length ear-length cropped very full thick thin fine wispy thinning receding wavy curly coily straight textured messy tousled neat trimmed groomed slicked slicked-back back tied loose side parted swept side-swept layered natural spiky wrapped length visible facial high low shoulder shoulders past",
);
/** An item must name at least one of these to be about the head or face. */
const HEAD_NOUNS = words(
  "hair bald headscarf hat cap beard stubble moustache mustache goatee glasses sunglasses spectacles ponytail bun braid braids plait plaits pixie bob afro dreadlocks locs cornrows curls mohawk undercut fringe bangs head hood beanie bandana headband sideburns clean-shaven scarf wrap",
);
const NOUNS = words(
  "jaw chin neck hairline shaved buzz crew cut braided top knot frames rimmed round rectangular thin-rimmed thick-rimmed small",
);
const CONNECTIVES = words("a an the and with no covering covers all most in up pulled around on");
const TRIM_START = new Set(words("a an the and with"));
const TRIM_END = new Set(words("a an the and with in up no"));

/** The only words an appearance line can contain (BANNED is a second gate on the whole item). */
export const APPEARANCE_VOCABULARY: ReadonlySet<string> = new Set([
  ...COLOURS,
  ...SHAPES,
  ...HEAD_NOUNS,
  ...NOUNS,
  ...CONNECTIVES,
]);
const HEAD_NOUN_SET = new Set(HEAD_NOUNS);
const MAX_ITEM_WORDS = 12;

const known = (token: string) =>
  APPEARANCE_VOCABULARY.has(token) ||
  (token.includes("-") && token.split("-").every((part) => APPEARANCE_VOCABULARY.has(part)));

/** One comma item → only its vocabulary words, or "" when nothing about the head or face is left. */
function cleanItem(item: string): string {
  if (BANNED.test(item)) return "";
  const tokens = item
    .toLowerCase()
    .split(/[^a-z-]+/)
    .filter((t) => t && known(t))
    .filter((t, i, all) => t !== all[i - 1]);
  while (tokens.length && TRIM_START.has(tokens[0] as string)) tokens.shift();
  while (tokens.length && TRIM_END.has(tokens[tokens.length - 1] as string)) tokens.pop();
  if (tokens.length > MAX_ITEM_WORDS || !tokens.some((t) => HEAD_NOUN_SET.has(t))) return "";
  return tokens.join(" ");
}

function clean(line: string): string {
  let out = line
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .replace(/[\p{Z}\s]+/gu, " ")
    .trim();
  for (const [pattern, word] of RENAME) out = out.replace(pattern, word);
  const items = out.split(",").map(cleanItem).filter(Boolean);
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
