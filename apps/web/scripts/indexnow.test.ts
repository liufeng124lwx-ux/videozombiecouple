import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEXNOW_KEY, indexNowBody, locs, newUrls } from "./indexnow.ts";

const map = (...urls: string[]) =>
  `<urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;

describe("IndexNow (spec 11.2)", () => {
  it("reads every <loc> in a sitemap", () => {
    expect(
      locs(map("https://videozombiecouple.com/", "https://videozombiecouple.com/pricing")),
    ).toEqual(["https://videozombiecouple.com/", "https://videozombiecouple.com/pricing"]);
  });

  it("submits only what the last deploy didn't have", () => {
    expect(
      newUrls(
        map("https://videozombiecouple.com/a"),
        map("https://videozombiecouple.com/a", "https://videozombiecouple.com/b"),
      ),
    ).toEqual(["https://videozombiecouple.com/b"]);
    expect(newUrls("", map("https://videozombiecouple.com/a"))).toEqual([
      "https://videozombiecouple.com/a",
    ]);
    expect(
      newUrls(map("https://videozombiecouple.com/a"), map("https://videozombiecouple.com/a")),
    ).toEqual([]);
  });

  it("names the key file the protocol checks", () => {
    expect(indexNowBody(["https://videozombiecouple.com/b"], "abc123")).toEqual({
      host: "videozombiecouple.com",
      key: "abc123",
      keyLocation: "https://videozombiecouple.com/abc123.txt",
      urlList: ["https://videozombiecouple.com/b"],
    });
  });

  it("publishes the key file the site serves", () => {
    expect(readFileSync(`public/${INDEXNOW_KEY}.txt`, "utf8")).toBe(INDEXNOW_KEY);
  });
});
