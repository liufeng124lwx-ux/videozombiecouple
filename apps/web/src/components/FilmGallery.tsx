import { t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";

export type GalleryFilm = {
  id: string;
  src: string;
  poster: string;
  /** Scene name, e.g. "Rainy city → Chapel". */
  scene: string;
  /** Who is in it, for the caption and the video's label. */
  who: string;
};

/**
 * Example films side by side. Each one plays muted while it is on screen (none load before the
 * section is reached); tapping a film turns its sound on and mutes the others.
 */
export default function FilmGallery({ films }: { films: GalleryFilm[] }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const [sound, setSound] = useState<number | null>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) void v.play().catch(() => undefined);
          else v.pause();
        }
      },
      { threshold: 0.6 },
    );
    for (const v of refs.current) if (v) seen.observe(v);
    return () => seen.disconnect();
  }, []);

  const tap = (i: number) => {
    refs.current.forEach((v, j) => {
      if (!v) return;
      v.muted = j !== i || sound === i;
      if (j === i && v.paused) void v.play().catch(() => undefined);
    });
    setSound(sound === i ? null : i);
  };

  return (
    <ul class="film-gallery">
      {films.map((f, i) => (
        <li key={f.id} class={sound === i ? "loud" : ""}>
          <button type="button" class="film-tile" onClick={() => tap(i)} aria-pressed={sound === i}>
            <video
              ref={(el) => {
                refs.current[i] = el;
              }}
              src={f.src}
              poster={f.poster}
              muted
              loop
              playsInline
              preload="none"
              width={540}
              height={960}
              aria-label={`${f.scene}: ${f.who}`}
            />
            <span class="film-sound">{sound === i ? t("film.soundOff") : t("film.soundOn")}</span>
          </button>
          <p class="scene">{f.scene}</p>
        </li>
      ))}
    </ul>
  );
}
