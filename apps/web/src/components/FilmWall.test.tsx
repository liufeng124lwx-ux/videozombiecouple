import { fireEvent, render, screen } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FilmWall, { type WallTileView } from "./FilmWall.tsx";

const tile = (id: string, group: WallTileView["group"], href: string): WallTileView => ({
  id,
  group,
  href,
  caption: `${group} · ${id}`,
  alt: `AI example: ${id}`,
  loop: `/samples/films/${id}-loop.mp4`,
  poster: `/p/${id}.jpg`,
});

const TILES = [
  tile("xmas-snow-cabin", "christmas", "/ai-christmas-video"),
  tile("xmas-city-flat", "christmas", "/ai-christmas-video"),
  tile("cabin", "zombie", "/zombie-love-story-ai"),
  tile("chapel", "zombie", "/zombie-love-story-ai"),
  tile("beach", "zombie", "/zombie-love-story-ai"),
  tile("pet", "pet", "/pet-zombie-video"),
];

let seen: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => undefined;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: typeof seen) {
        seen = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
});

describe("FilmWall", () => {
  it("shows every tile as a link to its story's page, posters only until seen", () => {
    const { container } = render(<FilmWall tiles={TILES} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(TILES.map((t) => t.href));
    const videos = [...container.querySelectorAll("video")];
    expect(videos).toHaveLength(6);
    for (const v of videos) {
      expect(v.getAttribute("preload")).toBe("none");
      expect(v.getAttribute("poster")).toMatch(/^\/p\//);
      expect(v.getAttribute("src")).toBeNull();
      expect(v.muted).toBe(true);
    }
  });

  it("loads and plays a loop only when its tile comes into view", () => {
    const { container } = render(<FilmWall tiles={TILES} />);
    const first = container.querySelector("video") as HTMLVideoElement;
    seen([{ target: first, isIntersecting: true }]);
    expect(first.getAttribute("src")).toBe("/samples/films/xmas-snow-cabin-loop.mp4");
    expect(first.play).toHaveBeenCalled();
    seen([{ target: first, isIntersecting: false }]);
    expect(first.pause).toHaveBeenCalled();
    const others = [...container.querySelectorAll("video")].slice(1);
    for (const v of others) expect(v.getAttribute("src")).toBeNull();
  });

  it("filters by story: All · Christmas · Zombie · Pet", () => {
    render(<FilmWall tiles={TILES} />);
    const chips = screen.getAllByRole("button").map((b) => b.textContent);
    expect(chips).toEqual(["All", "Christmas", "Zombie", "Pet"]);
    fireEvent.click(screen.getByRole("button", { name: "Pet" }));
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/pet-zombie-video",
    ]);
    expect(screen.getByRole("button", { name: "Pet" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Christmas" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });
});
