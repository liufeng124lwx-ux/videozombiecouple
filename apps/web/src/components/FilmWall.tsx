import { t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WallGroup, WallTile } from "../lib/home.ts";

export type WallTileView = Omit<WallTile, "id"> & { id: string; poster: string };

type Filter = "all" | WallGroup;

/**
 * The home page's film wall (showcase spec §4): a poster per story × scene, each tile a link to the
 * story's page. A tile's silent loop loads and plays only while it is on screen, so the wall adds
 * nothing to the page's first load (spec §8: home LCP stays the hero poster).
 */
export default function FilmWall({ tiles }: { tiles: WallTileView[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const refs = useRef(new Map<string, HTMLVideoElement>());
  const shown = tiles.filter((tile) => filter === "all" || tile.group === filter);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) {
            if (!v.getAttribute("src") && v.dataset.src) v.setAttribute("src", v.dataset.src);
            void v.play()?.catch(() => undefined);
          } else v.pause();
        }
      },
      { threshold: 0.5 },
    );
    for (const v of refs.current.values()) seen.observe(v);
    return () => seen.disconnect();
  }, [filter]);

  // A chip per story on the wall, in wall order (types only from lib/home.ts: keeps the island small).
  const chips: Filter[] = ["all", ...new Set(tiles.map((tile) => tile.group))];
  return (
    <div class="film-wall">
      <div class="wall-chips" role="group" aria-label={t("home.wall.filter")}>
        {chips.map((chip) => (
          <button
            type="button"
            key={chip}
            class={`chip${filter === chip ? " on" : ""}`}
            aria-pressed={filter === chip}
            onClick={() => setFilter(chip)}
          >
            {t(`home.wall.${chip}`)}
          </button>
        ))}
      </div>
      <ul class="wall-tiles">
        {shown.map((tile) => (
          <li key={tile.id} data-group={tile.group}>
            <a class="wall-tile" href={tile.href}>
              <video
                ref={(el) => {
                  if (el) refs.current.set(tile.id, el);
                  else refs.current.delete(tile.id);
                }}
                data-src={tile.loop}
                poster={tile.poster}
                muted
                loop
                playsInline
                preload="none"
                width="360"
                height="640"
                aria-label={tile.alt}
              />
              <span class="wall-caption scene">{tile.caption}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
