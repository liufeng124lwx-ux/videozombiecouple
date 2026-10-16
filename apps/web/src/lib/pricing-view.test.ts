import { storyOf, VIDEO_PACKS } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { packCards, packCardsFor } from "./pricing-view.ts";

describe("pack rows (spec §7)", () => {
  it("lists the three video packs with price, videos and price per video", () => {
    expect(packCards()).toEqual([
      {
        id: "pack1",
        videos: 1,
        price: "$4.99",
        perVideo: "$4.99",
        productKey: "pack1",
        popular: false,
        saving: null,
      },
      {
        id: "pack3",
        videos: 3,
        price: "$13.99",
        perVideo: "$4.66",
        productKey: "pack3",
        popular: true,
        saving: "7%",
      },
      {
        id: "pack5",
        videos: 5,
        price: "$21.99",
        perVideo: "$4.40",
        productKey: "pack5",
        popular: false,
        saving: "12%",
      },
    ]);
  });
});

describe("packCardsFor", () => {
  it("a story film lists its own pack, then only video packs that pay for one film", () => {
    const need = storyOf({ story: "christmas" }).credits;
    const cards = packCardsFor("christmas");
    expect(cards.map((c) => c.id)).toEqual(["christmas1", "pack3", "pack5"]);
    for (const card of cards.slice(1))
      expect(VIDEO_PACKS.find((p) => p.id === card.id)?.credits ?? 0).toBeGreaterThanOrEqual(need);
  });

  it("a buyer's balance counts: 10 credits make pack1 enough for a 20-credit film", () => {
    expect(packCardsFor("christmas", 0).map((c) => c.id)).toEqual(["christmas1", "pack3", "pack5"]);
    expect(packCardsFor("christmas", 10).map((c) => c.id)).toEqual([
      "christmas1",
      "pack1",
      "pack3",
      "pack5",
    ]);
    expect(packCardsFor("zombie", 0).map((c) => c.id)).toEqual(packCards().map((c) => c.id));
  });

  it("without a story the video packs are unchanged", () => {
    expect(packCardsFor().map((c) => c.id)).toEqual(packCards().map((c) => c.id));
  });
});
