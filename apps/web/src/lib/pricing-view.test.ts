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
        price: "$11.99",
        perVideo: "$4.00",
        productKey: "pack3",
        popular: true,
        saving: "20%",
      },
      {
        id: "pack10",
        videos: 10,
        price: "$29.99",
        perVideo: "$3.00",
        productKey: "pack10",
        popular: false,
        saving: "40%",
      },
    ]);
  });
});
