import { fact, featuredStory, pagePath, STORIES, type StoryId, storyPage } from "@vzc/catalog";
import { t } from "@vzc/i18n";
import { filmLoop, SAMPLE_FILMS, type SampleFilm, samplePair } from "./samples.ts";
import { heroFilm } from "./story-landing.ts";

/**
 * What the home page shows (showcase spec §4): the featured story's first screen and a wall with
 * one sample film per live story × scene. Numbers come from the catalog.
 */

/** The wall's filter chips after "All": the two stories, and the zombie story's pet version. */
export const WALL_GROUPS = ["christmas", "zombie", "pet"] as const;
export type WallGroup = (typeof WALL_GROUPS)[number];

export type WallTile = {
  id: SampleFilm["id"];
  group: WallGroup;
  /** The story's own page, where its tool is. */
  href: string;
  /** "Christmas · Snowy cabin": the scene words are long-tail text. */
  caption: string;
  alt: string;
  loop: string;
};

const groupOf = (film: SampleFilm): WallGroup => (film.kind === "pet" ? "pet" : film.story);

function hrefOf(film: SampleFilm): string {
  const page = storyPage(film.story, film.kind);
  if (!page) throw new Error(`sample film ${film.id}: its story has no live page`);
  return pagePath(page);
}

/** One tile per sample film whose scene is live, Christmas first, then zombie, then pet. */
export function wallTiles(): WallTile[] {
  return SAMPLE_FILMS.filter((film) => STORIES[film.story].scenes[film.scene]?.live)
    .map((film) => {
      const group = groupOf(film);
      const scene = STORIES[film.story].scenes[film.scene]?.label ?? film.scene;
      const who = samplePair(film.pair)?.who;
      if (!who) throw new Error(`sample film ${film.id} has no pair ${film.pair}`);
      return {
        id: film.id,
        group,
        href: hrefOf(film),
        caption: `${t(`home.wall.${group}`)} · ${scene}`,
        alt: `AI example: ${who} (${t(`home.wall.${group}`).toLowerCase()}, ${scene.toLowerCase()})`,
        loop: filmLoop(film.id),
      };
    })
    .sort((a, b) => WALL_GROUPS.indexOf(a.group) - WALL_GROUPS.indexOf(b.group));
}

export type HomeHero = {
  story: StoryId;
  film: SampleFilm;
  /** The featured story's page: the one button on the first screen. */
  href: string;
  eyebrow: string;
  subtitle: string;
  cta: string;
};

/** The first screen at `now` (build time): the featured story's film, words and page. */
export function homeHero(now: number): HomeHero {
  const story = featuredStory(now);
  const page = storyPage(story);
  if (!page) throw new Error(`featured story ${story} has no live page`);
  const facts = {
    seconds: fact(`story.${story}.seconds`),
    years: fact("story.christmas.years"),
  };
  return {
    story,
    film: heroFilm(undefined, story),
    href: pagePath(page),
    eyebrow: t(`home.featured.${story}.eyebrow`, facts),
    subtitle: t(`home.featured.${story}.subtitle`, facts),
    cta: t(`home.featured.${story}.cta`, facts),
  };
}
