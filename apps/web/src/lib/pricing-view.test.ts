import { describe, expect, it } from "vitest";
import { packCards } from "./pricing-view.ts";

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
