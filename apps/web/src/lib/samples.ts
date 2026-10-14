/**
 * Example couples (AI-generated people from the model eval, never users): their two source photos
 * and the standoff (A), embrace (B) and memory (C) frames GPT Image 2 made from them.
 */
export type SamplePair = {
  id: string;
  /** Short description for alt text. */
  who: string;
  film?: { src: string; poster: string };
};

export const SAMPLE_PAIRS: readonly SamplePair[] = [
  { id: "p03", who: "a young man with blond hair and a woman with long red hair" },
  {
    id: "p06",
    who: "a bearded man and a woman in a headscarf",
    film: { src: "/samples/p06-kling.mp4", poster: "p06-film-poster" },
  },
  { id: "p08", who: "a man with long locs and a woman with a pink bob" },
  { id: "p02", who: "a woman with curly hair and a man with a beard" },
];

export const HERO_PAIR = "p03";

export type Frame = "A" | "B" | "C" | "survivor" | "infected";

export function sampleFile(pair: string, frame: Frame | "film-poster"): string {
  return `${pair}-${frame}.jpg`;
}

export function sampleAlt(pair: SamplePair, frame: Frame): string {
  switch (frame) {
    case "A":
      return `AI example: the standoff — ${pair.who}, one of them turned, in a dark cabin`;
    case "B":
      return `AI example: the embrace in the cabin — ${pair.who}`;
    case "C":
      return `AI example: the memory — ${pair.who} hugging in a golden wheat field`;
    case "survivor":
      return `AI example photo: the survivor, ${pair.who.split(" and ")[0]}`;
    case "infected":
      return `AI example photo: the one who turns, ${pair.who.split(" and ")[1] ?? pair.who}`;
  }
}
