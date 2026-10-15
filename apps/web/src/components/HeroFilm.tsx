import { t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";

/** Where each beat starts in the film (seconds): standoff (shots 1–2), embrace, memory, dawn. */
const BEATS = [
  { key: "story.frame.standoff", from: 0 },
  { key: "story.frame.embrace", from: 5 },
  { key: "story.frame.memory", from: 8 },
  { key: "story.frame.dawn", from: 11 },
] as const;

/** The light each beat throws on the room around the film (design lock "Premiere Night"). */
const SPILL = ["#13263A", "#1C2633", "#4A3418", "#3A3324"] as const;

const PLAY = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
  </svg>
);
const PAUSE = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" />
  </svg>
);

type Props = {
  src: string;
  poster: string;
  label: string;
  /** The two example photos the film was made from. */
  sources?: { src: string; alt: string }[];
};

/**
 * The home page's first view: a finished example film, playing muted in a 9:16 frame, with the
 * story beats lighting up as it plays. Still (poster + play button) for reduced motion.
 */
export default function HeroFilm({ src, poster, label, sources = [] }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!still) void v.play().catch(() => undefined);
    const room = v.closest<HTMLElement>(".hero");
    const onTime = () => {
      const now = v.currentTime;
      const at = BEATS.reduce((found, b, i) => (now >= b.from ? i : found), 0);
      setBeat(at);
      room?.style.setProperty("--spill", SPILL[at] ?? SPILL[0]);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const toggleSound = () => {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (v.paused) void v.play().catch(() => undefined);
  };
  const togglePlay = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <div class="hero-film">
      <div class="reel">
        <video
          ref={video}
          src={src}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          width={540}
          height={960}
          aria-label={label}
          onClick={togglePlay}
        />
        <span class="reel-tag scene">{t("home.film.example")}</span>
        <div class="reel-controls">
          <button
            type="button"
            class="reel-btn"
            onClick={togglePlay}
            aria-label={playing ? t("film.pause") : t("film.play")}
          >
            {playing ? PAUSE : PLAY}
          </button>
          <button type="button" class="reel-btn" onClick={toggleSound} aria-pressed={!muted}>
            {muted ? t("film.soundOn") : t("film.soundOff")}
          </button>
        </div>
      </div>
      <ol class="reel-beats" aria-hidden="true">
        {BEATS.map((b, i) => (
          <li key={b.key} class={i === beat ? "on" : ""}>
            <span class="scene">{`0${i + 1}`}</span>
            {t(b.key)}
          </li>
        ))}
      </ol>
      {sources.length === 2 && (
        <div class="reel-sources">
          <span class="scene">{t("home.film.from")}</span>
          {sources.map((s) => (
            <img
              key={s.src}
              src={s.src}
              alt={s.alt}
              width={72}
              height={96}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      )}
    </div>
  );
}
