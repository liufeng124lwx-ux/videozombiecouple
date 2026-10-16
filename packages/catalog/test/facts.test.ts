import { describe, expect, it } from "vitest";
import { fact, facts, interpolate } from "../src/index.ts";

describe("page facts", () => {
  it("formats prices and per-video prices from the packs", () => {
    expect(fact("pack.pack1.usd")).toBe("$4.99");
    expect(fact("pack.pack3.usd")).toBe("$13.99");
    expect(fact("pack.pack3.videos")).toBe("3");
    expect(fact("pack.pack5.perVideo")).toBe("$4.40");
    expect(fact("price.fromPerVideo")).toBe("$4.40");
    expect(() => fact("pack.pack10.usd")).toThrow();
  });

  it("knows the story numbers", () => {
    expect(fact("video.seconds")).toBe("15");
    expect(fact("story.zombie.seconds")).toBe("15");
    expect(fact("story.christmas.seconds")).toBe("32");
    expect(fact("story.christmas.usd")).toBe("$9.99");
    expect(fact("story.christmas.credits")).toBe("20");
    expect(fact("story.christmas.minutes")).toBe("15");
    expect(fact("story.zombie.minutes")).toBe("5");
    expect(() => fact("pack.christmas1.videos")).toThrow();
    expect(fact("video.width")).toBe("720");
    expect(fact("video.height")).toBe("1280");
    expect(() => fact("preview.daily")).toThrow();
    expect(fact("remakes.perFilm")).toBe("1");
    expect(fact("candidates.perFrame")).toBe("2");
    expect(fact("retention.photosDays")).toBe("3");
    expect(fact("retention.guestFilmDays")).toBe("3");
    expect(fact("retention.memberFilmDays")).toBe("30");
  });

  it("fills {{key}} and fails on unknown keys", () => {
    expect(interpolate("From {{ price.fromPerVideo }} a video")).toBe("From $4.40 a video");
    expect(() => interpolate("{{nope}}")).toThrow(/Unknown fact/);
  });

  it("never yields NaN or undefined", () => {
    for (const [key, value] of Object.entries(facts()))
      expect(value, key).not.toMatch(/NaN|undefined/);
  });
});
