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

  it("never lets a banned inference survive; the line keeps only its hair, head, beard and glasses items", () => {
    for (const [bad, kept] of [
      ["Muslim woman in a headscarf", ""],
      ["Asian man, short black hair", "short black hair"],
      ["looks about 35 years old, short hair", "short hair"],
      ["Caucasian, blond hair", "blond hair"],
      ["appears pregnant", ""],
      ["wheelchair user, short hair", "short hair"],
      ["Indian, long black braid", "long black braid"],
      ["Indian braid, short hair", "short hair"],
      ["Thai woman, long black hair", "long black hair"],
      ["senior man, bald head", "bald head"],
      ["autistic, short hair", "short hair"],
      ["american flag shirt, short hair", "short hair"],
      ["earrings, red lipstick", ""],
      ["long red hair, freckles", "long red hair"],
      ["child-like face, curly hair", "curly hair"],
    ] as const)
      expect(parseAppearance(`IMAGE 1: ${bad}\nIMAGE 2: long red hair`), bad).toEqual({
        survivor: kept,
        infected: "long red hair",
      });
  });

  it("drops items that carry anything beyond head and face words", () => {
    for (const bad of [
      "grey hair typical of old age",
      "gray hair suggesting senior",
      "dreadlocks common in Jamaican culture",
      "Rastafarian dreadlocks",
      "hair of a Pakistani woman",
      "hair of a Nigerian",
      "hair typical of Black people",
      "hair that looks Middle Eastern",
      "beard in the Amish style",
      "beard like a rabbi",
      "payot sideburns",
      "Hasidic hat",
      "hair covering worn by nuns",
      "cap with a cross",
      "bald from chemotherapy",
      "bald due to cancer",
      "hair thinning with age",
      "hair looks 60",
      "hair in his sixties",
      "hair of a boy",
      "hair of a woman in her thirties",
      "cap saying Make America Great Again",
      "scarf reading ALLAH",
      "turban-style head wrap",
      "printed hair",
    ])
      expect(parseAppearance(`IMAGE 1: ${bad}`).survivor, bad).toBe("");
    expect(parseAppearance("IMAGE 1: glasses for poor eyesight, hair").survivor).toBe("hair");
  });

  it("passes plain descriptions built from the vocabulary", () => {
    for (const ok of [
      "blue floral headscarf covering all hair",
      "long wavy red hair",
      "short blond hair",
      "bald head",
      "clean-shaven",
      "full beard",
      "no head covering",
      "no glasses",
      "light stubble",
      "hair tied back",
      "short brown pixie cut",
      "shoulder-length grey hair",
      "hair in a bun",
    ])
      expect(parseAppearance(`IMAGE 1: ${ok}`).survivor, ok).toBe(ok);
  });

  it("normalises Unicode look-alikes before checking", () => {
    expect(parseAppearance("IMAGE 1: \uFF2Duslim hair").survivor).toBe("");
    expect(parseAppearance("IMAGE 1: Musl\u200Bim hair").survivor).toBe("");
    expect(parseAppearance("IMAGE 1: short\u00A0hair").survivor).toBe("short hair");
  });

  it("collapses repeated words after renaming and adds more garment names", () => {
    expect(parseAppearance("IMAGE 1: kufi cap").survivor).toBe("small cap");
    expect(parseAppearance("IMAGE 1: keffiyeh, dupatta covering hair").survivor).toBe(
      "headscarf, headscarf covering hair",
    );
  });

  it("collapses a run of repeated words and refuses over-long items (more than 8 words)", () => {
    expect(parseAppearance(`IMAGE 1: ${"very ".repeat(60)}long hair`).survivor).toBe(
      "very long hair",
    );
    expect(
      parseAppearance("IMAGE 1: long long long short short short long long hair hair").survivor,
    ).toBe("long short long hair");
    expect(
      parseAppearance("IMAGE 1: long hair with a bun and a hat and a cap and a scarf").survivor,
    ).toBe("");
  });

  it("caps at an item boundary", () => {
    const items = Array.from({ length: 20 }, () => "short hair").join(", ");
    const out = parseAppearance(`IMAGE 1: ${items}`).survivor;
    expect(out.length).toBeLessThanOrEqual(APPEARANCE_MAX_CHARS);
    expect(out).toMatch(/hair$/);
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
