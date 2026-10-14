import { fact, type Kind, type SceneId, TIERS } from "@vzc/catalog";
import { errorMessage, t } from "@vzc/i18n";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { track } from "../../lib/analytics.ts";
import { ApiError } from "../../lib/api.ts";
import { onSignedIn, openSignIn } from "../../lib/bus.ts";
import { loadMe, refreshMe } from "../../lib/me.ts";
import {
  createStory,
  getQuota,
  getStory,
  newIdempotencyKey,
  recompose,
  render,
  uploadPhoto,
} from "../../lib/story/client.ts";
import { canSubmit, initialState, reduce, type Slot } from "../../lib/story/machine.ts";
import { preparePhoto } from "../../lib/story/prepare.ts";
import { forgetStory, rememberedStory, rememberStory, renderKey } from "../../lib/story/resume.ts";
import { getToken } from "../../lib/turnstile.ts";
import GradeWipe from "../GradeWipe.tsx";
import PackRows from "../pricing/PackRows.tsx";
import {
  PhotoSlot,
  ScenePicker,
  type ScenePoster,
  TitleCardFields,
  WaitingFrames,
} from "./parts.tsx";

export type StoryToolProps = {
  preset?: { kind?: Kind; scene?: SceneId };
  posters: Partial<Record<SceneId, ScenePoster>>;
  /** "home": a fresh tool (resumes a remembered story) · "story": /story?id=… */
  mode?: "home" | "story";
  pollMs?: number;
};

const POLL_MS = 3_000;
const PREVIEW_STAGES = [
  "story.previewing.stage1",
  "story.previewing.stage2",
  "story.previewing.stage3",
] as const;
const RENDER_STAGES = [
  "story.rendering.stage1",
  "story.rendering.stage2",
  "story.rendering.stage3",
  "story.rendering.stage4",
  "story.rendering.stage5",
] as const;

function message(code: string | null): string | null {
  if (!code) return null;
  return errorMessage(code);
}

/**
 * The tool (design lock "Tool states"): two photos → free preview → pack → render → film.
 * Everything the server knows comes from GET /v1/stories/:id; this island only drives it.
 */
export default function StoryTool({
  preset,
  posters,
  mode = "home",
  pollMs = POLL_MS,
}: StoryToolProps) {
  const [s, dispatch] = useReducer(reduce, initialState(preset));
  const [credits, setCredits] = useState<number | null>(null);
  const [previewsLeft, setPreviewsLeft] = useState<number | null>(null);
  const [title, setTitle] = useState({ names: "", date: "", open: false });
  const [copied, setCopied] = useState(false);
  const turnstile = useRef<HTMLDivElement>(null);
  const waitingForSignIn = useRef(false);
  const autoRender = useRef(false);
  const token = () => {
    const el = turnstile.current;
    if (!el) return Promise.reject(new Error("CHALLENGE_REQUIRED"));
    return getToken(el, "job");
  };

  // Resume: /story?id=…, or the story this browser was working on.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id =
      params.get("id") ?? params.get("story") ?? (mode === "home" ? rememberedStory() : null);
    autoRender.current = params.get("render") === "1" || params.get("paid") === "1";
    if (id) dispatch({ type: "resume", storyId: id });
    void loadMe().then((me) => setCredits(me?.credits ?? null));
    void getQuota()
      .then((q) => setPreviewsLeft(q.loginRequired ? null : q.remaining))
      .catch(() => undefined);
  }, []);

  // Poll the story while the server is working on it.
  useEffect(() => {
    if (!s.storyId) return;
    const running = s.phase === "previewing" || s.phase === "rendering" || s.phase === "uploading";
    let alive = true;
    const tick = async () => {
      try {
        const view = await getStory(s.storyId as string);
        if (alive) dispatch({ type: "view", view });
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && error.code === "NOT_FOUND") {
          forgetStory();
          dispatch({ type: "reset" });
        }
      }
    };
    void tick();
    if (!running) return () => void (alive = false);
    const timer = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [s.storyId, s.phase === "previewing" || s.phase === "rendering"]);

  // Analytics and the end of a run.
  useEffect(() => {
    if (s.phase === "preview_ready") track("preview_done", {});
    if (s.phase === "done") {
      track("video_done", {});
      void refreshMe().then((me) => setCredits(me?.credits ?? null));
    }
    if (s.phase === "preview_ready" && autoRender.current) {
      autoRender.current = false;
      void startRender();
    }
  }, [s.phase]);

  useEffect(
    () =>
      onSignedIn(() => {
        if (!waitingForSignIn.current) return;
        waitingForSignIn.current = false;
        void refreshMe().then((me) => setCredits(me?.credits ?? null));
        void submit();
      }),
    [s.photos, s.scene, s.kind, s.title],
  );

  async function onFile(slot: Slot, file: File) {
    dispatch({ type: "checking", slot });
    const check = slot === "infected" && s.kind === "pet" ? "pet" : "face";
    const prepared = await preparePhoto(file, check);
    if (!prepared.ok) return dispatch({ type: "photoError", slot, code: prepared.code });
    dispatch({
      type: "photo",
      slot,
      photo: { jpeg: prepared.jpeg, url: URL.createObjectURL(prepared.jpeg), face: prepared.face },
    });
  }

  async function submit() {
    if (!canSubmit(s)) return;
    const me = await refreshMe();
    if (!me?.user) {
      waitingForSignIn.current = true;
      openSignIn({ heading: t("story.signIn"), next: `${location.pathname}#make` });
      return;
    }
    dispatch({ type: "submit" });
    track("preview_start", { kind: s.kind, scene: s.scene });
    try {
      const survivorKey = await uploadPhoto((s.photos.survivor as { jpeg: Blob }).jpeg, token);
      const infectedKey = await uploadPhoto((s.photos.infected as { jpeg: Blob }).jpeg, token);
      const storyId = await createStory(
        {
          survivorKey,
          infectedKey,
          kind: s.kind,
          scene: s.scene,
          ...(s.title.names ? { names: s.title.names } : {}),
          ...(s.title.date ? { date: s.title.date } : {}),
          idempotencyKey: newIdempotencyKey(),
        },
        token,
      );
      rememberStory(storyId);
      if (mode === "home")
        history.replaceState(null, "", `${location.pathname}?story=${storyId}#make`);
      dispatch({ type: "created", storyId });
      setPreviewsLeft((n) => (n === null ? n : Math.max(0, n - 1)));
    } catch (error) {
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  async function startRender() {
    const id = s.storyId;
    if (!id) return;
    try {
      await render(id, renderKey(id, newIdempotencyKey), token);
      track("video_purchase", {});
      dispatch({ type: "rendering" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CREDITS_LOW")
        return dispatch({ type: "pay" });
      if (error instanceof ApiError && error.code === "LOGIN_REQUIRED")
        return openSignIn({ heading: t("story.signIn") });
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  async function saveTitle() {
    if (!s.storyId) return;
    try {
      await recompose(s.storyId, { names: title.names, date: title.date });
      setTitle((v) => ({ ...v, open: false }));
      dispatch({ type: "rendering" });
    } catch (error) {
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  function startOver() {
    forgetStory();
    if (mode === "home") history.replaceState(null, "", `${location.pathname}#make`);
    dispatch({ type: "reset" });
  }

  const busy = s.phase !== "setup";
  const story = s.story;
  const videos = credits === null ? null : Math.floor(credits / TIERS.video.credits);

  return (
    <div class="tool" data-phase={s.phase}>
      {(s.phase === "setup" || s.phase === "uploading") && (
        <div class="tool-setup">
          <div class="kind-toggle" role="radiogroup" aria-label={t("story.kind.label")}>
            {(["human", "pet"] as const).map((k) => (
              <button
                type="button"
                key={k}
                role="radio"
                aria-checked={s.kind === k}
                class="chip"
                disabled={busy}
                onClick={() => dispatch({ type: "kind", kind: k })}
              >
                {t(`story.kind.${k}`)}
              </button>
            ))}
          </div>
          <div class="slots">
            <PhotoSlot
              slot="survivor"
              kind={s.kind}
              photo={s.photos.survivor}
              checking={s.checking.survivor}
              disabled={busy}
              onFile={onFile}
            />
            <button
              type="button"
              class="swap"
              aria-label={t("story.swap")}
              title={t("story.swap")}
              disabled={busy || s.kind === "pet" || !(s.photos.survivor || s.photos.infected)}
              onClick={() => dispatch({ type: "swap" })}
            >
              ⇄
            </button>
            <PhotoSlot
              slot="infected"
              kind={s.kind}
              photo={s.photos.infected}
              checking={s.checking.infected}
              disabled={busy}
              onFile={onFile}
            />
          </div>
          <ul class="tips small">
            <li class="check">{t("story.tips.front")}</li>
            <li class="check">{t("story.tips.one")}</li>
            <li class="check">{t("story.tips.light")}</li>
            <li class="check">{t("story.tips.adults")}</li>
          </ul>
          <ScenePicker
            scene={s.scene}
            posters={posters}
            disabled={busy}
            onPick={(scene) => dispatch({ type: "scene", scene })}
          />
          <TitleCardFields
            names={s.title.names}
            date={s.title.date}
            disabled={busy}
            onChange={(names, date) => dispatch({ type: "title", names, date })}
          />
          <p class="fine">{t("story.privacy", { photosDays: fact("retention.photosDays") })}</p>
          {s.error && (
            <p class="err-text small" role="alert">
              {message(s.error)}
            </p>
          )}
          <div class="tool-bar">
            <button
              type="button"
              class="btn btn-primary btn-lg btn-block"
              disabled={!canSubmit(s)}
              aria-busy={s.phase === "uploading"}
              onClick={() => void submit()}
            >
              {s.phase === "uploading"
                ? t("story.uploading")
                : s.photos.survivor && s.photos.infected
                  ? t("story.cta.preview")
                  : t("story.cta.addPhotos")}
            </button>
            {previewsLeft !== null && (
              <p class="fine">{t("story.cta.previewsLeft", { n: previewsLeft })}</p>
            )}
          </div>
        </div>
      )}

      {s.phase === "previewing" && (
        <div class="tool-wait">
          <h3>{t("story.previewing.title")}</h3>
          <WaitingFrames
            stages={PREVIEW_STAGES.map((k) => t(k))}
            done={story?.progress.done ?? 0}
            total={story?.progress.total ?? 5}
            etaMs={story?.progress.etaMs ?? null}
          />
        </div>
      )}

      {(s.phase === "preview_ready" || s.phase === "paying") && story?.preview && (
        <div class="tool-ready">
          <div class="ready-frames">
            <GradeWipe
              mode="drag"
              cold={{ src: story.preview.A, alt: "Your standoff frame" }}
              warm={{ src: story.preview.C, alt: "Your memory frame" }}
              priority
            />
            <div class="frame-labels scene" aria-hidden="true">
              <span>{t("story.frame.standoff")}</span>
              <span>{t("story.frame.memory")}</span>
            </div>
          </div>
          <div class="ready-side">
            <h3>{t("story.ready.title")}</h3>
            <p class="small muted">{t("story.ready.drag")}</p>
            {s.phase === "preview_ready" ? (
              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary btn-lg btn-block"
                  onClick={() => void startRender()}
                >
                  {videos !== null && videos > 0
                    ? t("story.ready.make")
                    : t("story.ready.makeWithPrice", { price: fact("price.fromPerVideo") })}
                </button>
                {videos !== null && videos > 0 && (
                  <p class="fine">
                    {videos === 1
                      ? t("story.ready.oneLeft")
                      : t("story.ready.balance", { n: videos })}
                  </p>
                )}
                <button type="button" class="btn btn-block" onClick={startOver}>
                  {t("story.ready.retry")}
                </button>
              </div>
            ) : (
              <div class="pay">
                <p class="scene">{t("story.pay.title")}</p>
                <PackRows returnPath={`/story?id=${s.storyId}&render=1`} />
                <button
                  type="button"
                  class="link small"
                  onClick={() => dispatch({ type: "cancelPay" })}
                >
                  {t("story.pay.back")}
                </button>
              </div>
            )}
            {s.error && (
              <p class="err-text small" role="alert">
                {message(s.error)}
              </p>
            )}
          </div>
        </div>
      )}

      {s.phase === "rendering" && (
        <div class="tool-render">
          <h3>{t("story.rendering.title")}</h3>
          {story?.preview ? (
            <GradeWipe
              mode="progress"
              value={story.progress.total ? (story.progress.done / story.progress.total) * 100 : 5}
              cold={{ src: story.preview.A, alt: "Your standoff frame" }}
              warm={{ src: story.preview.C, alt: "Your memory frame" }}
              label={t("story.rendering.title")}
            />
          ) : null}
          <div class="timeline scene" aria-hidden="true">
            <span>00:00</span>
            <span>00:{fact("video.seconds")}</span>
          </div>
          <WaitingFrames
            stages={RENDER_STAGES.map((k) => t(k))}
            done={story?.progress.done ?? 0}
            total={story?.progress.total ?? 6}
            etaMs={story?.progress.etaMs ?? null}
          />
          <p class="fine">{t("story.rendering.email")}</p>
        </div>
      )}

      {s.phase === "done" && story?.video && (
        <div class="tool-done">
          <div class="player">
            <video
              src={story.video.url}
              poster={story.video.poster}
              controls
              playsInline
              muted
              autoPlay
              loop
              preload="metadata"
            />
          </div>
          <div class="done-side">
            <h3>{t("story.done.title")}</h3>
            <a
              class="btn btn-primary btn-lg btn-block"
              href={story.video.url}
              download="zombie-love-story.mp4"
            >
              {t("story.done.download")}
            </a>
            <div class="actions">
              <button
                type="button"
                class="btn btn-sm"
                onClick={async () => {
                  const url = `${location.origin}/story?id=${story.id}`;
                  if (navigator.share)
                    await navigator
                      .share({ url, text: t("story.done.caption") })
                      .catch(() => undefined);
                  else {
                    await navigator.clipboard?.writeText(url);
                    setCopied(true);
                  }
                }}
              >
                {copied ? t("story.done.copied") : t("story.done.share")}
              </button>
              <button
                type="button"
                class="btn btn-sm"
                onClick={() => void navigator.clipboard?.writeText(t("story.done.caption"))}
              >
                {t("story.done.copyCaption")}
              </button>
            </div>
            {story.recomposeLeft > 0 &&
              (title.open ? (
                <div class="retitle">
                  <TitleCardFields
                    names={title.names}
                    date={title.date}
                    onChange={(names, date) => setTitle({ names, date, open: true })}
                  />
                  <button type="button" class="btn btn-block" onClick={() => void saveTitle()}>
                    {t("story.done.retitleSave")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  class="link small"
                  onClick={() =>
                    setTitle({ names: story.names ?? "", date: story.date ?? "", open: true })
                  }
                >
                  {t("story.done.retitle")}
                </button>
              ))}
            <p class="fine">{t("story.done.expires", { days: fact("retention.videoDays") })}</p>
            <button type="button" class="btn btn-block" onClick={startOver}>
              {t("story.done.another")}
            </button>
          </div>
        </div>
      )}

      {(s.phase === "preview_failed" || s.phase === "failed") && (
        <div class="tool-failed" role="alert">
          <p>{s.phase === "failed" ? t("story.failed.video") : t("story.failed.preview")}</p>
          {message(s.error) && <p class="small muted">{message(s.error)}</p>}
          <button type="button" class="btn btn-primary" onClick={startOver}>
            {t("story.failed.retry")}
          </button>
        </div>
      )}

      <div ref={turnstile} class="turnstile" />
    </div>
  );
}
