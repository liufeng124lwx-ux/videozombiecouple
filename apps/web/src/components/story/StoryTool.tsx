import { fact, type Kind, type SceneId, TIERS } from "@vzc/catalog";
import type { SharedFilm } from "@vzc/contracts";
import { errorMessage, t } from "@vzc/i18n";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { track } from "../../lib/analytics.ts";
import { ApiError } from "../../lib/api.ts";
import { onSignedIn, openSignIn } from "../../lib/bus.ts";
import { clearCheckout, pendingCheckout } from "../../lib/checkout.ts";
import { loadMe, refreshMe } from "../../lib/me.ts";
import {
  createStory,
  getSharedFilm,
  getStory,
  guestSignUp,
  newIdempotencyKey,
  recompose,
  remake,
  render,
  uploadPhoto,
} from "../../lib/story/client.ts";
import { canSubmit, initialState, reduce, type Slot } from "../../lib/story/machine.ts";
import { preparePhoto } from "../../lib/story/prepare.ts";
import { forgetStory, rememberedStory, rememberStory, renderKey } from "../../lib/story/resume.ts";
import { getToken } from "../../lib/turnstile.ts";
import PackRows from "../pricing/PackRows.tsx";
import {
  PhotoSlot,
  RenderMonitor,
  ScenePicker,
  type ScenePoster,
  TitleCardFields,
} from "./parts.tsx";

export type StoryToolProps = {
  preset?: { kind?: Kind; scene?: SceneId };
  posters: Partial<Record<SceneId, ScenePoster>>;
  /** "home": a fresh tool (resumes a remembered story) · "story": /story?id=… */
  mode?: "home" | "story";
  pollMs?: number;
};

const POLL_MS = 3_000;
/** A checkout started this recently may still be on its way (webhook not yet in). */
const CHECKOUT_FRESH_MS = 30 * 60_000;
/** How long to wait for a payment's credits before asking the buyer to refresh. */
const CONFIRM_WAIT_MS = 60_000;

const deleteDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric" });

function message(code: string | null): string | null {
  if (!code) return null;
  return errorMessage(code);
}

/**
 * The tool: two photos (checked for one adult face each) → pay (a guest leaves an email first) →
 * the film. Nothing is generated for free (owner, 2026-10-15).
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
  const [signedIn, setSignedIn] = useState(false);
  const [verified, setVerified] = useState(true);
  const [email, setEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [title, setTitle] = useState({ names: "", date: "", open: false });
  const [copied, setCopied] = useState(false);
  const [payment, setPayment] = useState<"confirming" | "slow" | null>(null);
  const [shared, setShared] = useState<SharedFilm | "gone" | null>(null);
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
    const shareId = params.get("id");
    const shareKey = params.get("t");
    if (shareId && shareKey) {
      // Someone else's film, opened from its share link: read-only.
      void getSharedFilm(shareId, shareKey)
        .then(setShared)
        .catch(() => setShared("gone"));
      return;
    }
    const id =
      params.get("id") ?? params.get("story") ?? (mode === "home" ? rememberedStory() : null);
    autoRender.current = params.get("render") === "1" || params.get("paid") === "1";
    if (id) dispatch({ type: "resume", storyId: id });
    void loadMe().then(applyMe);
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
      void refreshMe().then(applyMe);
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
        void refreshMe().then(applyMe);
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

  function applyMe(me: Awaited<ReturnType<typeof refreshMe>>) {
    setCredits(me?.credits ?? null);
    setSignedIn(Boolean(me?.user));
    setVerified(me?.user ? me.user.verified !== false : true);
  }

  /** A guest leaves an email before paying; it becomes their account (no password, no code). */
  async function continueAsGuest(event: Event) {
    event.preventDefault();
    setEmailBusy(true);
    try {
      const human = () => {
        const el = turnstile.current;
        return el ? getToken(el, "login") : Promise.reject(new Error("CHALLENGE_REQUIRED"));
      };
      await guestSignUp(email.trim(), human);
      applyMe(await refreshMe());
    } catch (error) {
      if (error instanceof ApiError && error.code === "LOGIN_REQUIRED") {
        // The email already has an account: confirm it with a code, then pay.
        waitingForSignIn.current = true;
        openSignIn({
          heading: t("story.pay.haveAccount"),
          next: `${location.pathname}${location.search}`,
        });
      } else dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    } finally {
      setEmailBusy(false);
    }
  }

  async function startRemake() {
    if (!s.storyId) return;
    try {
      await remake(s.storyId);
      dispatch({ type: "rendering" });
    } catch (error) {
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  async function submit() {
    if (!canSubmit(s)) return;
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
    } catch (error) {
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  async function startRender(): Promise<void> {
    const id = s.storyId;
    if (!id) return;
    try {
      await render(id, renderKey(id, newIdempotencyKey), token);
      clearCheckout();
      track("video_purchase", {});
      dispatch({ type: "rendering" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CREDITS_LOW") {
        // Back from checkout: the payment's credits may not have landed yet. Wait for them
        // rather than offering packs again (a second payment).
        const pending = pendingCheckout();
        if (pending && Date.now() - pending.at < CHECKOUT_FRESH_MS)
          return confirmPayment(pending.credits);
        return dispatch({ type: "pay" });
      }
      if (error instanceof ApiError && error.code === "LOGIN_REQUIRED")
        return openSignIn({ heading: t("story.signIn") });
      dispatch({ type: "error", code: error instanceof ApiError ? error.code : "INTERNAL" });
    }
  }

  async function confirmPayment(before: number): Promise<void> {
    setPayment("confirming");
    const until = Date.now() + CONFIRM_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, pollMs));
      const now = await refreshMe().catch(() => null);
      if ((now?.credits ?? 0) > before) {
        setCredits(now?.credits ?? null);
        setPayment(null);
        clearCheckout();
        return startRender();
      }
    }
    setPayment("slow");
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

  if (shared)
    return (
      <div class="tool tool-shared" data-clarity-mask="true">
        {shared === "gone" ? (
          <p class="notice">{t("story.shared.gone")}</p>
        ) : (
          <div class="tool-done">
            <div class="player">
              <video
                src={shared.video.url}
                poster={shared.video.poster}
                controls
                playsInline
                muted
                autoPlay
                loop
                preload="metadata"
              />
            </div>
            <div class="done-side">
              <p class="scene">{t("story.shared.title")}</p>
              {shared.names && <h3>{shared.names}</h3>}
              {shared.date && <p class="small muted">{shared.date}</p>}
              <p class="small muted">
                {t("story.shared.note", { seconds: fact("video.seconds") })}
              </p>
            </div>
          </div>
        )}
        <a class="btn btn-primary btn-lg btn-block" href="/">
          {t("story.shared.cta")}
        </a>
      </div>
    );

  return (
    <div class="tool" data-phase={s.phase} data-clarity-mask="true">
      {(s.phase === "setup" || s.phase === "uploading") && (
        <div class="tool-setup">
          <div class="tool-step cast">
            <p class="step-title">
              {t(s.kind === "pet" ? "story.step.castPet" : "story.step.cast", { n: 1 })}
            </p>
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
          </div>
          <div class="tool-step set">
            <p class="step-title">{t("story.step.scene", { n: 2 })}</p>
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
          </div>

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
                  ? t("story.cta.make")
                  : t("story.cta.addPhotos")}
            </button>
            <p class="fine">
              {t("story.cta.note", {
                price: fact("price.fromPerVideo"),
                remakes: fact("remakes.perFilm"),
              })}
            </p>
          </div>
        </div>
      )}

      {s.phase === "previewing" && (
        <div class="tool-wait" role="status">
          <h3>{t("story.checking.title")}</h3>
          <p class="small muted">{t("story.checking.text")}</p>
        </div>
      )}

      {(s.phase === "preview_ready" || s.phase === "paying") && (
        <div class="tool-ready">
          <div class="ready-photos" aria-hidden="true">
            {(["survivor", "infected"] as const).map((slot) =>
              s.photos[slot] ? <img key={slot} src={s.photos[slot]?.url} alt="" /> : null,
            )}
          </div>
          <div class="ready-side">
            <p class="scene">{t("story.ready.kicker")}</p>
            <h3>{t("story.ready.title")}</h3>
            <p class="small muted">
              {t("story.ready.text", {
                seconds: fact("video.seconds"),
                remakes: fact("remakes.perFilm"),
              })}
            </p>
            {payment !== null ? (
              <p class="notice" role="status">
                {payment === "confirming" ? t("story.pay.confirming") : t("story.pay.slow")}
              </p>
            ) : signedIn && videos !== null && videos > 0 ? (
              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary btn-lg btn-block"
                  onClick={() => void startRender()}
                >
                  {t("story.ready.make")}
                </button>
                <p class="fine">
                  {videos === 1
                    ? t("story.ready.oneLeft")
                    : t("story.ready.balance", { n: videos })}
                </p>
              </div>
            ) : !signedIn ? (
              <form class="guest" onSubmit={(e) => void continueAsGuest(e)}>
                <label class="field">
                  <span>{t("story.pay.emailLabel")}</span>
                  <input
                    type="email"
                    required
                    autocomplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                  />
                </label>
                <p class="fine">{t("story.pay.emailNote")}</p>
                <button
                  type="submit"
                  class="btn btn-primary btn-lg btn-block"
                  aria-busy={emailBusy}
                  disabled={emailBusy}
                >
                  {t("story.pay.continue")}
                </button>
                <button
                  type="button"
                  class="link small"
                  onClick={() => {
                    waitingForSignIn.current = true;
                    openSignIn({
                      heading: t("story.signIn"),
                      next: `${location.pathname}${location.search}`,
                    });
                  }}
                >
                  {t("story.pay.signIn")}
                </button>
              </form>
            ) : (
              <div class="pay">
                <p class="scene">{t("story.pay.title")}</p>
                <PackRows returnPath={`/story?id=${s.storyId}&render=1`} />
              </div>
            )}
            {s.error && (
              <p class="err-text small" role="alert">
                {message(s.error)}
              </p>
            )}
            <button type="button" class="link small" onClick={startOver}>
              {t("story.ready.retry")}
            </button>
          </div>
        </div>
      )}

      {s.phase === "rendering" && (
        <div class="tool-render">
          <h3>{t("story.rendering.title")}</h3>
          <RenderMonitor
            stages={story?.stages}
            frames={story?.frames}
            done={story?.progress.done ?? 0}
            total={story?.progress.total ?? 0}
            etaMs={story?.progress.etaMs ?? null}
            scene={story?.scene ?? s.scene}
          />
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
                  const url = story.shareToken
                    ? `${location.origin}/story?id=${story.id}&t=${story.shareToken}`
                    : `${location.origin}/story?id=${story.id}`;
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
            <p class="notice" role="note">
              {t("story.done.expires", { date: deleteDate(story.video.expiresAt) })}
              {!verified &&
                ` ${t("story.done.keepLonger", { days: fact("retention.memberFilmDays") })}`}
            </p>
            {story.remakeLeft > 0 && (
              <button type="button" class="link small" onClick={() => void startRemake()}>
                {t("story.done.remake")}
              </button>
            )}
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
          {s.phase === "failed" && (s.story?.videoAttempts ?? 0) > 0 ? (
            <>
              <button type="button" class="btn btn-primary" onClick={() => void startRender()}>
                {t("story.failed.again")}
              </button>
              <button type="button" class="link small" onClick={startOver}>
                {t("story.failed.newPhotos")}
              </button>
            </>
          ) : (
            <button type="button" class="btn btn-primary" onClick={startOver}>
              {t("story.failed.retry")}
            </button>
          )}
        </div>
      )}

      <div ref={turnstile} class="turnstile" />
    </div>
  );
}
