import "../../styles/dialog.css";
import { errorMessage, t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { ApiError, apiOrigin, post } from "../../lib/api.ts";
import type { SignInRequest } from "../../lib/bus.ts";
import { withHumanCheck } from "../../lib/human-pass.ts";
import { getToken as turnstileToken } from "../../lib/turnstile.ts";
import Modal from "../Modal.tsx";
import CodeInput from "./CodeInput.tsx";

export const RESEND_SECONDS = 60;

type Step = "start" | "password" | "code";
type Props = {
  request: SignInRequest;
  onClose: () => void;
  onSignedIn: (created: boolean) => void;
  getToken?: (container: HTMLElement, action: "login") => Promise<string>;
};

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return errorMessage("INTERNAL");
  return errorMessage(
    error.code,
    error.retryAfterSec === undefined ? {} : { seconds: error.retryAfterSec },
  );
}

/** Design S9 / flows ②③: Google first, then an emailed code (stay on the page), or a password. */
export default function SignInDialog({
  request,
  onClose,
  onSignedIn,
  getToken = turnstileToken,
}: Props) {
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const challenge = useRef<HTMLDivElement>(null);
  const next = request.next ?? `${location.pathname}${location.search}`;

  useEffect(() => {
    if (step !== "code") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      await withHumanCheck(
        (headers) => post("/v1/auth/email", { email, next }, headers),
        () => getToken(challenge.current ?? document.body, "login"),
      );
      setStep("code");
      setResendAt(Date.now() + RESEND_SECONDS * 1000);
      setNow(Date.now());
    });

  const verifyCode = (code: string) =>
    run(async () => {
      try {
        const result = await post<{ created: boolean }>("/v1/auth/code", { email, code });
        onSignedIn(result.created);
      } catch (failure) {
        setAttempt((n) => n + 1);
        throw failure;
      }
    });

  const signInWithPassword = () =>
    run(async () => {
      const result = await post<{ created: boolean }>("/v1/auth/password", { email, password });
      onSignedIn(result.created);
    });

  const left = Math.max(0, Math.ceil((resendAt - now) / 1000));
  const emailField = (
    <label class="field">
      <span>{t("auth.email")}</span>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder={t("auth.emailPlaceholder")}
        value={email}
        onInput={(e) => setEmail(e.currentTarget.value)}
      />
    </label>
  );

  return (
    <Modal labelledBy="signin-title" onClose={onClose}>
      <button type="button" class="x" aria-label={t("auth.close")} onClick={onClose}>
        ✕
      </button>
      {step === "code" ? (
        <div class="stack">
          <h2 id="signin-title">{t("auth.checkEmail")}</h2>
          <p class="sub">{t("auth.codeSent", { email })}</p>
          <CodeInput key={attempt} disabled={busy} onComplete={verifyCode} />
          <p class="fine">
            {t("auth.noEmail")}{" "}
            {left > 0 ? (
              <span>{t("auth.resendIn", { time: clock(left) })}</span>
            ) : (
              <button type="button" class="link" disabled={busy} onClick={sendCode}>
                {t("auth.resend")}
              </button>
            )}
          </p>
          <button
            type="button"
            class="link"
            onClick={() => {
              setStep("start");
              setError(null);
            }}
          >
            {t("auth.otherEmail")}
          </button>
        </div>
      ) : (
        <div class="stack">
          <h2 id="signin-title">{request.heading ?? t("auth.title")}</h2>
          <p class="sub">{t("auth.subtitle")}</p>
          <a
            class="btn btn-block"
            href={`${apiOrigin()}/auth/google/start?next=${encodeURIComponent(next)}`}
          >
            {t("auth.google")}
          </a>
          <div class="divider">{t("auth.or")}</div>
          {step === "start" ? (
            <form
              class="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void sendCode();
              }}
            >
              {emailField}
              <button class="btn btn-primary btn-block" type="submit" disabled={busy}>
                {t("auth.sendCode")}
              </button>
              <button type="button" class="link" onClick={() => setStep("password")}>
                {t("auth.usePassword")}
              </button>
            </form>
          ) : (
            <form
              class="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void signInWithPassword();
              }}
            >
              {emailField}
              <label class="field">
                <span>{t("auth.password")}</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                />
              </label>
              <button class="btn btn-primary btn-block" type="submit" disabled={busy}>
                {t("auth.signIn")}
              </button>
              <button type="button" class="link" onClick={() => setStep("start")}>
                {t("auth.useCode")}
              </button>
            </form>
          )}
          <p class="fine">
            {t("auth.agree")} <a href="/terms">{t("auth.terms")}</a> {t("auth.and")}{" "}
            <a href="/privacy">{t("auth.privacy")}</a>.
          </p>
        </div>
      )}
      {error && (
        <div class="notice err">
          <span class="ic" aria-hidden="true" />
          <span role="alert">{error}</span>
        </div>
      )}
      <div ref={challenge} class="challenge" />
    </Modal>
  );
}
