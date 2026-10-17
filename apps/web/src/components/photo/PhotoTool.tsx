import { fact, PHOTO, pagePath, storyPage } from "@vzc/catalog";
import { type StoryView, UPLOAD_CONSENT_VERSION } from "@vzc/contracts";
import { errorMessage, t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { track } from "../../lib/analytics.ts";
import { ApiError } from "../../lib/api.ts";
import { createPhoto, getStory, newIdempotencyKey, uploadPhoto } from "../../lib/story/client.ts";
import { preparePhoto } from "../../lib/story/prepare.ts";
import { getToken } from "../../lib/turnstile.ts";

/** The upsell describes the zombie film, so it always goes to the zombie story's page. */
const zombiePage = storyPage("zombie");
const ZOMBIE_HREF = zombiePage ? pagePath(zombiePage) : "/";

type Phase = "setup" | "working" | "done";

const STAGES = ["photo.checking", "photo.making", "photo.stamping"] as const;

const messageOf = (code: string) =>
  code === "DAILY_LIMIT" ? t("photo.dailyLimit") : errorMessage(code);

/**
 * The free AI zombie filter (SEO review 2026-10-15): one photo in, one watermarked zombie portrait
 * out, then the film. The same consent and human check as the film tool.
 */
export default function PhotoTool({ pollMs = 3_000 }: { pollMs?: number }) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [photo, setPhoto] = useState<{ jpeg: Blob; url: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [story, setStory] = useState<StoryView | null>(null);
  const [storyId, setStoryId] = useState<string | null>(null);
  const turnstile = useRef<HTMLDivElement>(null);
  const token = () => {
    const el = turnstile.current;
    return el ? getToken(el, "job") : Promise.reject(new Error("CHALLENGE_REQUIRED"));
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setChecking(true);
    const prepared = await preparePhoto(file, "face");
    setChecking(false);
    if (!prepared.ok) {
      setPhoto(null);
      setError(messageOf(prepared.code));
      return;
    }
    setPhoto({ jpeg: prepared.jpeg, url: URL.createObjectURL(prepared.jpeg) });
  }

  async function submit() {
    if (!photo || !consent) return;
    setError(null);
    setPhase("working");
    track("preview_start", { kind: "photo", scene: "photo" });
    try {
      const photoKey = await uploadPhoto(photo.jpeg, token);
      const id = await createPhoto(
        { photoKey, consent: UPLOAD_CONSENT_VERSION, idempotencyKey: newIdempotencyKey() },
        token,
      );
      setStoryId(id);
    } catch (failure) {
      setPhase("setup");
      setError(messageOf(failure instanceof ApiError ? failure.code : "INTERNAL"));
    }
  }

  // Follow the photo until it is done or refused.
  useEffect(() => {
    if (!storyId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const view = await getStory(storyId);
        if (!alive) return;
        setStory(view);
        if (view.status === "done" && view.photo) {
          setPhase("done");
          track("preview_done", {});
          return;
        }
        if (view.status === "preview_failed" || view.status === "failed") {
          setPhase("setup");
          setStoryId(null);
          setError(messageOf(view.errorCode ?? "INTERNAL"));
          return;
        }
      } catch {
        // A failed poll is tried again.
      }
      timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [storyId]);

  const hours = String(PHOTO.keepHours);
  const done = story?.progress.done ?? 0;
  const stage = STAGES[Math.min(STAGES.length - 1, done)] ?? STAGES[0];

  if (phase === "done" && story?.photo)
    return (
      <div class="photo-tool photo-done" data-clarity-mask="true">
        <figure class="photo-print">
          <img src={story.photo} alt={t("photo.alt")} width="600" height="800" />
        </figure>
        <div class="photo-side">
          <h3>{t("photo.done")}</h3>
          <a class="btn btn-primary" href={story.photo} download="zombie-photo.jpg">
            {t("photo.download")}
          </a>
          <p class="fine">{t("photo.deleted", { hours })}</p>
          <div class="photo-upsell">
            <p class="scene">{t("photo.upsell.title")}</p>
            <p>
              {t("photo.upsell.text", {
                seconds: fact("video.seconds"),
                price: fact("price.fromPerVideo"),
              })}
            </p>
            <a class="btn btn-lg" href={ZOMBIE_HREF}>
              {t("photo.upsell.cta")}
            </a>
          </div>
        </div>
      </div>
    );

  return (
    <div class="photo-tool" data-clarity-mask="true">
      <label class={`photo-slot${photo ? " has" : ""}`}>
        {photo ? <img src={photo.url} alt="" /> : <span class="plus" aria-hidden="true" />}
        <span class="photo-slot-label">{t(photo ? "photo.change" : "photo.pick")}</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          disabled={phase !== "setup"}
          onChange={(e) => void onFile(e.currentTarget.files?.[0])}
        />
      </label>
      <div class="photo-side">
        <p class="small muted">{t("photo.tips")}</p>
        <label class="consent small">
          <input
            type="checkbox"
            checked={consent}
            disabled={phase !== "setup"}
            onChange={(e) => setConsent(e.currentTarget.checked)}
          />
          <span>
            {t("photo.consent", { adult: fact("age.adult") })}{" "}
            <a href="/terms">{t("story.consent.terms")}</a> ·{" "}
            <a href="/privacy#biometric-data">{t("story.consent.biometric")}</a>
          </span>
        </label>
        {error && (
          <p class="err-text small" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          class="btn btn-primary btn-lg btn-block"
          disabled={phase !== "setup" || !photo || !consent || checking}
          aria-busy={phase === "working"}
          onClick={() => void submit()}
        >
          {phase === "working" ? t("photo.working") : t("photo.go")}
        </button>
        {phase === "working" && <p class="scene">{t(stage)}</p>}
        <p class="fine">{t("photo.free", { hours })}</p>
        <div ref={turnstile} class="turnstile" />
      </div>
    </div>
  );
}
