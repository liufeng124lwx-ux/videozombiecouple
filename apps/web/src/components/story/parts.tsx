import { fact, type Kind, SCENE_IDS, SCENES, type SceneId } from "@vzc/catalog";
import { t } from "@vzc/i18n";
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
  photo: Photo | null;
  checking: boolean;
  disabled: boolean;
  onFile: (slot: Slot, file: File) => void;
}) {
  const { slot, kind, photo, checking } = props;
  const label =
    slot === "survivor"
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
  scene: SceneId;
  posters: Partial<Record<SceneId, ScenePoster>>;
  disabled: boolean;
  onPick: (scene: SceneId) => void;
}) {
  return (
    <fieldset class="scenes">
      <legend class="visually-hidden">{t("story.scene.label")}</legend>
      <div class="scene-tiles" role="radiogroup">
        {SCENE_IDS.map((id) => {
          const scene = SCENES[id];
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
              <span class="ticket-line">
                {t(`story.scene.line.${id}` as "story.scene.line.cabin-wheat")}
              </span>
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
}) {
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
              placeholder={t("story.title.datePlaceholder")}
              disabled={props.disabled}
              onInput={(e) => props.onChange(props.names, e.currentTarget.value)}
            />
          </label>
        </div>
        <div class="titlecard-preview" aria-hidden="true">
          <p class="tc-line">{t("story.title.line")}</p>
          <p class="tc-names">
            {[props.names || t("story.title.namesPlaceholder"), props.date]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>
    </details>
  );
}

/** Two empty frames sharpening while the keyframes are made (TikTok "blurred to sharp"). */
export function WaitingFrames(props: {
  stages: string[];
  done: number;
  total: number;
  etaMs: number | null;
}) {
  const share = props.total > 0 ? Math.round((props.done / props.total) * 100) : 0;
  const stage =
    props.stages[
      Math.min(props.stages.length - 1, Math.floor((share / 100) * props.stages.length))
    ];
  return (
    <div class="waiting">
      <div class="waiting-frames" aria-hidden="true">
        <span class="frame cold" />
        <span class="frame warm" />
      </div>
      <div
        class="progress-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share}
      >
        <i style={{ transform: `scaleX(${Math.max(0.04, share / 100)})` }} />
      </div>
      <p class="scene">{`SC. ${Math.max(1, props.stages.indexOf(stage ?? "") + 1)} — ${stage ?? ""}`}</p>
      <p class="small muted">
        {props.etaMs !== null && props.etaMs > 0
          ? props.etaMs > 60_000
            ? t("story.eta", { min: Math.ceil(props.etaMs / 60_000) })
            : t("story.etaSoon")
          : t("story.etaSoon")}{" "}
        · {t("story.leave")}
      </p>
    </div>
  );
}

export function fromPrice(): string {
  return fact("price.fromPerVideo");
}
