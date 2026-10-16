import { describe, expect, it } from "vitest";
import { APPEARANCE_MAX_CHARS, DESCRIBE_PROMPT, parseAppearance } from "../src/index.ts";

describe("appearance lines", () => {
  it("reads two lines into photo 1 (survivor) and photo 2 (infected)", () => {
    expect(
      parseAppearance(
        "IMAGE 1: short blond hair, clean-shaven, no glasses\nIMAGE 2: long wavy red hair",
      ),
    ).toEqual({
      survivor: "short blond hair, clean-shaven, no glasses",
      infected: "long wavy red hair",
    });
  });

  it("tolerates spacing, case, bullets and extra chatter, keeping the first line per image", () => {
    const text =
      "Sure! Here you go:\n- image 2 : bald head, grey stubble\n* IMAGE 1:short curly black hair\nIMAGE 1: ignored";
    expect(parseAppearance(text)).toEqual({
      survivor: "short curly black hair",
      infected: "bald head, grey stubble",
    });
  });

  it("renames religious garments to neutral words", () => {
    expect(parseAppearance("IMAGE 2: blue floral hijab covering all hair").infected).toBe(
      "blue floral headscarf covering all hair",
    );
    expect(parseAppearance("IMAGE 1: black Turban, full beard").survivor).toBe(
      "black head wrap, full beard",
    );
    expect(parseAppearance("IMAGE 1: kippah, short hair").survivor).toBe("small cap, short hair");
  });

  it("drops a line that infers religion, ethnicity, nationality, health or age", () => {
    for (const bad of [
      "Muslim woman in a headscarf",
      "Asian man, short black hair",
      "looks about 35 years old, short hair",
      "Caucasian, blond hair",
      "appears pregnant",
      "wheelchair user, short hair",
      "Indian, long black braid",
    ])
      expect(parseAppearance(`IMAGE 1: ${bad}\nIMAGE 2: long red hair`), bad).toEqual({
        survivor: "",
        infected: "long red hair",
      });
  });

  it("keeps hair colours like white and black hair (they are not ethnicity)", () => {
    expect(parseAppearance("IMAGE 1: white hair, black glasses").survivor).toBe(
      "white hair, black glasses",
    );
  });

  it("caps a line, strips control characters, and gives empty lines for garbage", () => {
    const long = `IMAGE 1: ${"very ".repeat(60)}long hair`;
    expect(parseAppearance(long).survivor.length).toBeLessThanOrEqual(APPEARANCE_MAX_CHARS);
    expect(parseAppearance("IMAGE 1: short\u0000 hair\u0007").survivor).toBe("short hair");
    expect(parseAppearance("")).toEqual({ survivor: "", infected: "" });
    expect(parseAppearance("I can't help with that.")).toEqual({ survivor: "", infected: "" });
  });

  it("instructs the model to describe only what is visible, in the fixed format", () => {
    expect(DESCRIBE_PROMPT).toContain("IMAGE 1:");
    expect(DESCRIBE_PROMPT).toContain("IMAGE 2:");
    expect(DESCRIBE_PROMPT).toMatch(/never mention (age|religion)/i);
  });
});
