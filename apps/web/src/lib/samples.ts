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

/** The pet version's example: an AI-generated woman and her cat (eval persona q01). */
export const PET_PAIR: SamplePair = {
  id: "q01",
  who: "a woman with long brown hair and her orange tabby cat",
};

/** The second Christmas example (eval persona p07); it has no standoff frames, only its film. */
export const CHRISTMAS_PAIR: SamplePair = {
  id: "p07",
  who: "an older bald man and a woman with short grey hair",
};

/** Any example by id (the pet and Christmas examples are not part of the couples' gallery). */
export function samplePair(id: string): SamplePair | undefined {
  return [...SAMPLE_PAIRS, PET_PAIR, CHRISTMAS_PAIR].find((p) => p.id === id);
}

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

/** The hero's cold frame: the LCP image of the home and landing pages (preloaded in <head>). */
export const HERO_SIZES = "(min-width: 900px) 420px, 82vw";

/**
 * Finished example films (AI-generated people and pets, made by the real pipeline on staging).
 * `public/samples/films/<id>.mp4` is the whole film, `<id>-loop.mp4` a silent 4 s piece around the
 * match cut (scene picker), and `film-<id>-poster.jpg` its opening frame.
 */
export type SampleFilm = {
  id: "cabin" | "chapel" | "beach" | "pet" | "xmas-snow-cabin" | "xmas-city-flat";
  story: "zombie" | "christmas";
  scene: "cabin-wheat" | "rain-chapel" | "lighthouse-beach" | "snow-cabin" | "city-flat";
  pair: string;
  kind: "human" | "pet";
  /** The day the film was added to the site (VideoObject uploadDate). */
  added: string;
};

export const SAMPLE_FILMS: readonly SampleFilm[] = [
  {
    id: "cabin",
    story: "zombie",
    scene: "cabin-wheat",
    pair: "p02",
    kind: "human",
    added: "2026-10-14",
  },
  {
    id: "chapel",
    story: "zombie",
    scene: "rain-chapel",
    pair: "p02",
    kind: "human",
    added: "2026-10-14",
  },
  {
    id: "beach",
    story: "zombie",
    scene: "lighthouse-beach",
    pair: "p03",
    kind: "human",
    added: "2026-10-14",
  },
  {
    id: "pet",
    story: "zombie",
    scene: "cabin-wheat",
    pair: "q01",
    kind: "pet",
    added: "2026-10-14",
  },
  {
    id: "xmas-snow-cabin",
    story: "christmas",
    scene: "snow-cabin",
    pair: "p03",
    kind: "human",
    added: "2026-10-16",
  },
  {
    id: "xmas-city-flat",
    story: "christmas",
    scene: "city-flat",
    pair: "p07",
    kind: "human",
    added: "2026-10-16",
  },
];

/** The zombie films only: the home page's scene picker and gallery read scenes from the zombie story. */
export const ZOMBIE_FILMS: readonly SampleFilm[] = SAMPLE_FILMS.filter((f) => f.story === "zombie");

export const filmSrc = (id: SampleFilm["id"]) => `/samples/films/${id}.mp4`;
export const filmLoop = (id: SampleFilm["id"]) => `/samples/films/${id}-loop.mp4`;
export const filmPoster = (id: SampleFilm["id"]) => `film-${id}-poster.jpg`;
/** The warm memory frame: what a paused film shows in the gallery, so the scenes read apart. */
export const filmMemory = (id: SampleFilm["id"]) => `film-${id}-memory.jpg`;
