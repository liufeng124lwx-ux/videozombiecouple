import { defineCollection } from "astro:content";
import { interpolate } from "@vzc/catalog";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/** Frontmatter strings may use {{key}} for catalog numbers; an unknown key fails the build. */
const text = z.string().transform((value) => interpolate(value));
const item = z.object({ title: text, text });

/** One MDX per page, at src/content/pages/en/<page id>.mdx (spec §6). */
const pages = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/pages" }),
  schema: z.object({
    title: text,
    description: text,
    /** Hero: screenplay scene heading, the line under the H1, and the trust line. */
    scene: text.optional(),
    lede: text.optional(),
    trust: z.array(text).optional(),
    /** Example pair for the hero (lib/samples.ts); the home page's couple when absent. */
    hero: z.string().optional(),
    /** Example film in the hero (lib/samples.ts SAMPLE_FILMS); "cabin" when absent. */
    film: z
      .enum(["cabin", "chapel", "beach", "pet", "xmas-snow-cabin", "xmas-city-flat"])
      .optional(),
    /** The three beats of the film (standoff, embrace, memory). */
    beats: z.array(item).length(3).optional(),
    /** "Will it look like us?" section. */
    likeness: z.object({ title: text, text }).optional(),
    /** Photo tips (good / avoid). */
    tips: z.object({ good: z.array(text), avoid: z.array(text) }).optional(),
    /** The HowTo name in the structured data (default: "How to make a <h1> video"). */
    howTo: text.optional(),
    /** How it works: exactly three steps. */
    steps: z.array(item).length(3).optional(),
    /** Honest comparison with the other ways to make this video. */
    compare: z
      .object({
        title: text,
        intro: text.optional(),
        rows: z.array(z.object({ way: text, how: text, catch: text })),
      })
      .optional(),
    pet: z.object({ title: text, text }).optional(),
    /** Story pages: what happens to the photos (showcase spec §5.4). */
    privacy: z.object({ title: text, text }).optional(),
    closing: z.object({ title: text, text }).optional(),
    faq: z.array(z.object({ q: text, a: text })).optional(),
    published: z.coerce.date().optional(),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { pages };
