import {
  fact,
  type Kind,
  SCENE_IDS,
  SCENES,
  type StoryId,
  sceneLabel,
  storyOf,
} from "@vzc/catalog";
import type { StageView } from "@vzc/contracts";
import { type MessageKey, t } from "@vzc/i18n";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Photo, Slot } from "../../lib/story/machine.ts";

/** A scene's opening frame and its silent loop around the match cut (lib/samples.ts). */
export type ScenePoster = { still: string; clip: string };

/** Plays while picked or hovered; otherwise rests on its first frame. */
function SceneClip({ poster, on }: { poster: ScenePoster; on: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if ((on || hover) && !still) void v.play?.()?.catch(() => undefined);
    else v.pause?.();
  }, [on, hover]);
  return (
    <video
      ref={ref}
      class="scene-clip"
      src={poster.clip}
      poster={poster.still}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    />
  );
}

/** A 3:4 photo slot as a screen-test polaroid (design lock "One-Sheet"): SCREEN TEST 001 / ROLE. */
export function PhotoSlot(props: {
  slot: Slot;
  kind: Kind;
  story?: StoryId;
  photo: Photo | null;
  checking: boolean;
  disabled: boolean;
  onFile: (slot: Slot, file: File) => void;
}) {
  const { slot, kind, photo, checking } = props;
  const label =
    props.story === "christmas"
      ? t(slot === "survivor" ? "story.christmas.slot.survivor" : "story.christmas.slot.infected")
      : slot === "survivor"
        ? t("story.slot.survivor")
        : kind === "pet"
          ? t("story.slot.pet")
          : t("story.slot.infected");
  const id = `photo-${slot}`;
  const face = photo?.face;
  const warn = face === "none" || face === "many" || face === "small";
  const pick = (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file) props.onFile(slot, file);
    e.currentTarget.value = "";
  };
  return (
    <div class={`slot slot-${slot}${photo ? " filled" : ""}${warn ? " warn" : ""}`}>
      <div class="polaroid">
        <span class="tape" aria-hidden="true" />
        <label class="slot-frame" for={id}>
          {photo ? (
            <img src={photo.url} alt={label} />
          ) : (
            <span class="slot-empty">
              <span class="slot-plus" aria-hidden="true">
                +
              </span>
              {t("story.slot.add")}
            </span>
          )}
          {checking && <span class="slot-busy">{t("story.slot.checking")}</span>}
        </label>
        <p class="polaroid-caption">
          <span>{t("story.slot.test", { n: slot === "survivor" ? "001" : "002" })}</span>
          <span class="slot-label">{t("story.slot.role", { role: label })}</span>
        </p>
      </div>
      <input
        id={id}
        class="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        disabled={props.disabled}
        onChange={pick}
      />
      {photo && !checking && (
        <p class={`slot-status small${warn ? " warn" : ""}`}>
          {warn ? (
            t(`story.face.${face}` as "story.face.none")
          ) : (
            <span class="check">{t(`story.face.${face ?? "ok"}` as "story.face.ok")}</span>
          )}
          {" · "}
          <label class="link" for={id}>
            {t("story.slot.replace")}
          </label>
        </p>
      )}
    </div>
  );
}

/** The scenes as cinema tickets (design lock "One-Sheet"); the picked one plays its clip. */
export function ScenePicker(props: {
  story?: StoryId;
  scene: string;
  posters: Partial<Record<string, ScenePoster>>;
  disabled: boolean;
  onPick: (scene: string) => void;
}) {
  const tale = props.story ?? "zombie";
  const zombie = tale === "zombie";
  const scenes = zombie
    ? SCENE_IDS.map((id) => SCENES[id])
    : Object.values(storyOf({ story: tale }).scenes);
  const line = (id: string) =>
    (zombie ? `story.scene.line.${id}` : `story.${tale}.scene.line.${id}`) as MessageKey;
  return (
    <fieldset class="scenes">
      <legend class="visually-hidden">{t("story.scene.label")}</legend>
      <div class="scene-tiles" role="radiogroup">
        {scenes.map((scene) => {
          const id = scene.id;
          const poster = props.posters[id];
          const on = props.scene === id;
          return (
            <button
              type="button"
              key={id}
              role="radio"
              aria-checked={on}
              class={`scene-tile${on ? " on" : ""}${scene.live ? "" : " soon"}`}
              disabled={props.disabled || !scene.live}
              onClick={() => props.onPick(id)}
            >
              <span class="scene-name">{scene.label}</span>
              <span class="ticket-window">
                {poster ? (
                  <SceneClip poster={poster} on={on} />
                ) : (
                  <span class="scene-blank" aria-hidden="true" />
                )}
              </span>
              <span class="ticket-line">{t(line(id))}</span>
              <span class="ticket-stub" aria-hidden="true">
                {scene.live
                  ? on
                    ? `${t("story.scene.selected")} ★`
                    : `${t("story.scene.select")} ☆`
                  : t("story.scene.soon")}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** The optional end title, with a live preview of the card in the film. */
export function TitleCardFields(props: {
  names: string;
  date: string;
  onChange: (names: string, date: string) => void;
  disabled?: boolean;
  story?: StoryId;
}) {
  const christmas = props.story === "christmas";
  const datePlaceholder = t(
    christmas ? "story.christmas.title.datePlaceholder" : "story.title.datePlaceholder",
  );
  // The Christmas end card is the story's own (its year comes from the date line).
  const card = christmas
    ? storyOf({ story: "christmas" }).title({
        names: props.names || null,
        date: props.date || null,
        createdAt: Date.now(),
      })
    : null;
  return (
    <details class="titlecard" open={!!(props.names || props.date)}>
      <summary>{t("story.title.add")}</summary>
      <div class="titlecard-body">
        <div class="titlecard-fields">
          <label class="field">
            <span class="scene">{t("story.title.names")}</span>
            <input
              type="text"
              maxLength={40}
              value={props.names}
              placeholder={t("story.title.namesPlaceholder")}
              disabled={props.disabled}
              onInput={(e) => props.onChange(e.currentTarget.value, props.date)}
            />
          </label>
          <label class="field">
            <span class="scene">{t("story.title.date")}</span>
            <input
              type="text"
              maxLength={20}
              value={props.date}
              placeholder={datePlaceholder}
              disabled={props.disabled}
              onInput={(e) => props.onChange(props.names, e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="titlecard-preview" aria-hidden="true">
          {card ? (
            <>
              <p class="tc-line">{card.line1}</p>
              {card.line2 && <p class="tc-line">{card.line2}</p>}
              <p class="tc-names">{props.names || t("story.title.namesPlaceholder")}</p>
            </>
          ) : (
            <>
              <p class="tc-line">{t("story.title.line")}</p>
              <p class="tc-names">
                {[props.names || t("story.title.namesPlaceholder"), props.date]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          )}
        </div>
      </div>
    </details>
  );
}

/** Two empty frames sharpening while the keyframes are made (TikTok "blurred to sharp"). */
const STAGE_LABEL = {
  frames: "story.rendering.frames",
  "shot:1": "story.rendering.shot1",
  "shot:2": "story.rendering.shot2",
  "shot:3": "story.rendering.shot3",
  "shot:4": "story.rendering.shot4",
  "shot:5": "story.rendering.shot5",
  compose: "story.rendering.compose",
} as const;
/** Christmas makes shots 1–3 and 5–8; 4 and 9 are the scene's own clips (catalog storyboard). */
const CHRISTMAS_STAGE_LABEL = {
  frames: "story.christmas.rendering.frames",
  "shot:1": "story.christmas.rendering.shot1",
  "shot:2": "story.christmas.rendering.shot2",
  "shot:3": "story.christmas.rendering.shot3",
  "shot:5": "story.christmas.rendering.shot5",
  "shot:6": "story.christmas.rendering.shot6",
  "shot:7": "story.christmas.rendering.shot7",
  "shot:8": "story.christmas.rendering.shot8",
  compose: "story.christmas.rendering.compose",
} as const;
const STAGE_LABELS: Record<StoryId, Readonly<Record<string, MessageKey>>> = {
  zombie: STAGE_LABEL,
  christmas: CHRISTMAS_STAGE_LABEL,
};
/** Shown until the server reports its stages (an older story, or the first poll). */
const defaultStages = (story: StoryId): StageView[] =>
  Object.keys(STAGE_LABELS[story]).map((id) => ({ id, state: "waiting" }));
/** The film's length: the zombie film keeps its own fact, other stories theirs. */
export function filmSeconds(story: StoryId = "zombie"): string {
  return story === "zombie" ? fact("video.seconds") : fact(`story.${story}.seconds`);
}
const STILL_MS = 3_500;

const timecode = (seconds: number) =>
  `00:${String(Math.max(0, Math.min(99, Math.floor(seconds)))).padStart(2, "0")}`;

/**
 * Rendering, as a film set: a monitor shows the film's own stills as they are made (a slate until
 * the first one), beside the shot list with each step's real state and one progress bar.
 */
export function RenderMonitor(props: {
  stages: StageView[] | undefined;
  frames: string[] | undefined;
  done: number;
  total: number;
  etaMs: number | null;
  scene: string;
  story?: StoryId;
}) {
  const story = props.story ?? "zombie";
  const labels = STAGE_LABELS[story];
  const FILM_SECONDS = Number.parseInt(filmSeconds(story), 10) || 0;
  const stages = props.stages?.length ? props.stages : defaultStages(story);
  const frames = props.frames ?? [];
  const share = props.total > 0 ? props.done / props.total : 0;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = setInterval(() => setShown((i) => i + 1), STILL_MS);
    return () => clearInterval(timer);
  }, [frames.length]);
  const current = frames.length ? shown % frames.length : -1;
  const eta =
    props.etaMs !== null && props.etaMs > 60_000
      ? t("story.eta", { min: Math.ceil(props.etaMs / 60_000) })
      : t("story.etaSoon");
  return (
    <div class="render-set">
      <div class="monitor" aria-hidden="true">
        {frames.length === 0 ? (
          <div class="slate">
            <span class="slate-stick" />
            <span class="slate-board">
              <b>{sceneLabel(props.scene)}</b>
              <i>{t("story.rendering.slate")}</i>
            </span>
          </div>
        ) : (
          frames.map((src, i) => (
            <img key={src} src={src} alt="" class={i === current ? "on" : undefined} />
          ))
        )}
        <span class="rec">{"REC"}</span>
        <span class="tc">
          {timecode(share * FILM_SECONDS)} / {timecode(FILM_SECONDS)}
        </span>
        <span class="scan" />
      </div>
      <div class="render-side">
        <p class="scene">{t("story.rendering.shotList")}</p>
        <ol class="shot-list">
          {stages.map((stage) => (
            <li key={stage.id} data-state={stage.state}>
              <span class="dot" aria-hidden="true" />
              <span class="name">
                {t(labels[stage.id] ?? labels.compose ?? STAGE_LABEL.compose)}
              </span>
              <span class="state">{t(`story.rendering.${stage.state}`)}</span>
            </li>
          ))}
        </ol>
        <div
          class="progress-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <i style={{ transform: `scaleX(${Math.max(0.04, share)})` }} />
        </div>
        <p class="small muted">
          {eta} · {t("story.leave")}
        </p>
        <p class="fine">{t("story.rendering.email")}</p>
      </div>
    </div>
  );
}

export function fromPrice(): string {
  return fact("price.fromPerVideo");
}
