import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fact, interpolate } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { handWrittenNumbers } from "../lib/numbers.ts";
import { storyBeats } from "../lib/story-landing.ts";

const mdx = readFileSync(
  join(import.meta.dirname, "../content/pages/en/ai-christmas-video.mdx"),
  "utf8",
);
const frontmatter = mdx.split("---")[1] ?? "";
const field = (name: string) =>
  (frontmatter.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1] ?? "").replace(/^"|"$/g, "");
const faq = [...frontmatter.matchAll(/- q: (.+)\n\s+a: (.+)/g)].map((m) => ({
  q: m[1] ?? "",
  a: m[2] ?? "",
}));
const template = readFileSync(join(import.meta.dirname, "HomePage.astro"), "utf8");
const markup = template.split("---").slice(2).join("---");

describe("/ai-christmas-video content (showcase spec §5)", () => {
  it("names the keyword cluster in the title and description, within the length rules", () => {
    const title = interpolate(field("title"));
    const description = interpolate(field("description"));
    expect(title.toLowerCase()).toContain("ai christmas video generator");
    expect(description.toLowerCase()).toContain("personalized christmas video");
    expect(title.length).toBeGreaterThanOrEqual(30);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(description.length).toBeGreaterThanOrEqual(120);
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("opens on a Christmas sample film", () => {
    expect(field("film")).toMatch(/^xmas-/);
  });

  it("says the length, price and wait from the catalog", () => {
    expect(field("lede")).toContain("{{story.christmas.seconds}}");
    expect(field("lede")).toContain("{{story.christmas.usd}}");
    expect(mdx).toContain("about {{story.christmas.minutes}} minutes");
  });

  it("has three beats, one per storyboard beat, and three steps", () => {
    const beats = frontmatter.split(/^steps:/m)[0]?.split(/^beats:/m)[1] ?? "";
    expect(beats.match(/- title:/g)).toHaveLength(storyBeats("christmas").length);
    const steps = frontmatter.split(/^steps:/m)[1]?.split(/^\w+:/m)[0] ?? "";
    expect(steps.match(/- title:/g)).toHaveLength(3);
  });

  it("states the photo deletion window from the catalog", () => {
    const privacy = frontmatter.split(/^privacy:/m)[1]?.split(/^\w+:/m)[0] ?? "";
    expect(privacy).toContain("{{retention.photosDays}}");
  });

  it("answers the gift and Christmas card questions truthfully", () => {
    const gift = faq.find((f) => /gift/i.test(f.q));
    const card = faq.find((f) => /Christmas card/i.test(f.q));
    expect(gift?.q).toBe("Can I give it as a gift?");
    expect(card?.q).toBe("Can I send it as a Christmas card?");
    for (const answer of [gift?.a, card?.a]) expect(answer).toMatch(/MP4/);
    expect(card?.a).toMatch(/no printed cards|don't print|do not print/i);
  });

  it("writes no hard-coded numbers, and never says free", () => {
    expect(handWrittenNumbers(mdx)).toEqual([]);
    const body = mdx.replace(/^(published|updated): .*$/gm, "");
    for (const n of ["seconds", "usd", "credits", "minutes", "years"])
      expect(body, n).not.toMatch(
        new RegExp(`(^|\\D)${fact(`story.christmas.${n}`).replace(/[$.]/g, "\\$&")}(\\D|$)`),
      );
    expect(body).not.toMatch(/\bfree\b/i);
  });
});

describe("HomePage.astro on a story page", () => {
  it("opens the tool on the page's preset and builds story sections from the catalog", () => {
    expect(markup).toMatch(/<StoryTool client:load posters=\{posters\} preset=\{preset\} \/>/);
    expect(template).toMatch(/storyBeats\(story\)/);
    expect(template).toMatch(/storySamples\(story\)/);
    expect(template).toMatch(/heroFilm\(d\.film, story\)/);
  });

  it("takes every number from the catalog", () => {
    expect(markup.replace(/fact\("[^"]+"\)/g, "")).not.toMatch(
      /\$\d|\b\d+ (videos|days|seconds|minutes|credits)\b/,
    );
  });
});
