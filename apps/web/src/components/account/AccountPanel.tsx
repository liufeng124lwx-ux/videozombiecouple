import { type Kind, SCENES, type SceneId, TIERS } from "@vzc/catalog";
import {
  type AccountView,
  type BillingView,
  isSameSitePath,
  type StoryStatus,
} from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { ApiError, api, post } from "../../lib/api.ts";
import { notifySignedIn, onSignedIn, openSignIn } from "../../lib/bus.ts";
import { clockTime, shortDate } from "../../lib/format.ts";
import { refreshMe } from "../../lib/me.ts";
import { messageOf } from "../auth/SignInDialog.tsx";
import DeleteAccount from "./DeleteAccount.tsx";
import LedgerTable from "./LedgerTable.tsx";
import SignInMethods from "./SignInMethods.tsx";

/** GET /v1/quota: free previews left today (spec §7). */
type Quota = { remaining: number; limit: number; resetAt: number | null; loginRequired?: boolean };
/** GET /v1/stories: the member's stories, newest first. */
export type StorySummary = {
  id: string;
  status: StoryStatus | "expired";
  kind: Kind;
  scene: SceneId;
  createdAt: number;
};
type Data = {
  account: AccountView;
  billing: BillingView;
  quota: Quota;
  stories: StorySummary[];
};
type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Data };

const sameSite = (path: string | null): path is string => path !== null && isSameSitePath(path);
const count = (n: number) => n.toLocaleString("en-US");

function StoryRow({ story }: { story: StorySummary }) {
  const scene = SCENES[story.scene]?.label ?? story.scene;
  return (
    <li>
      <a href={`/story?id=${encodeURIComponent(story.id)}`}>
        <span class="story-name">
          {scene} · {t(`story.kind.${story.kind}` as const)}
        </span>
        <span class={`scene story-status is-${story.status}`}>
          {t(`account.storyStatus.${story.status}` as const)}
        </span>
        <span class="small muted">{shortDate(story.createdAt)}</span>
      </a>
    </li>
  );
}

/** Spec 5.5 / design S15: videos left, today's free previews, stories, activity, sign-in, delete. */
export default function AccountPanel({ navigate = (url: string) => location.assign(url) }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  /** A sign-in link opened in a browser other than the one that asked for it: whose account? */
  const [confirmLink, setConfirmLink] = useState<{
    token: string;
    email: string;
    next: string | null;
  } | null>(null);

  /** Signs in with an emailed link; false when the person here must confirm the account first. */
  async function redeem(token: string, next: string | null, confirm: boolean): Promise<boolean> {
    const result = await post<{ ok: boolean; created?: boolean; confirm?: string }>(
      "/v1/auth/link",
      confirm ? { token, confirm: true } : { token },
    );
    if (!result.ok && result.confirm) {
      setConfirmLink({ token, email: result.confirm, next });
      return false;
    }
    await refreshMe();
    notifySignedIn(result.created === true);
    if (sameSite(next) && next !== "/account") {
      navigate(next);
      return false;
    }
    return true;
  }

  async function load() {
    setState({ kind: "loading" });
    try {
      const [account, billing, quota, list] = await Promise.all([
        api<AccountView>("/v1/account"),
        api<BillingView>("/v1/billing"),
        api<Quota>("/v1/quota"),
        api<{ stories: StorySummary[] }>("/v1/stories"),
      ]);
      setState({ kind: "ready", data: { account, billing, quota, stories: list.stories } });
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        (failure.code === "UNAUTHORIZED" || failure.code === "LOGIN_REQUIRED")
      )
        setState({ kind: "signedOut" });
      else setState({ kind: "error", message: messageOf(failure) });
    }
  }

  const signedOut = () => setState({ kind: "signedOut" });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("login");
    const next = params.get("next");
    if (token || params.has("error")) history.replaceState(null, "", location.pathname);
    if (params.get("error") === "google") setNotice(t("account.googleError"));
    void (async () => {
      if (token) {
        try {
          if (!(await redeem(token, next, false))) return;
        } catch (failure) {
          setNotice(messageOf(failure));
        }
      }
      await load();
    })();
    return onSignedIn(() => void load());
  }, []);

  const banner = notice && (
    <div class="notice err">
      <span class="ic" aria-hidden="true" />
      <span role="alert">{notice}</span>
    </div>
  );

  if (confirmLink)
    return (
      <section class="account-section">
        <h2>{t("account.linkConfirm.title", { email: confirmLink.email })}</h2>
        <p class="muted">{t("account.linkConfirm.text")}</p>
        <div class="actions">
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => {
              const { token, next } = confirmLink;
              setConfirmLink(null);
              void redeem(token, next, true)
                .then(async (stay) => {
                  if (stay) await load();
                })
                .catch((failure) => {
                  setNotice(messageOf(failure));
                  void load();
                });
            }}
          >
            {t("nav.signIn")}
          </button>
          <button
            type="button"
            class="btn"
            onClick={() => {
              setConfirmLink(null);
              void load();
            }}
          >
            {t("account.linkConfirm.notMe")}
          </button>
        </div>
      </section>
    );
  if (state.kind === "loading")
    return (
      <div aria-busy="true">
        {banner}
        <p class="muted">{t("account.loading")}</p>
      </div>
    );
  if (state.kind === "signedOut")
    return (
      <div class="stack">
        {banner}
        <section class="account-section">
          <h2>{t("account.signedOut.title")}</h2>
          <p class="muted">{t("account.signedOut.text")}</p>
          <button
            type="button"
            class="btn btn-primary"
            onClick={() => openSignIn({ next: "/account" })}
          >
            {t("nav.signIn")}
          </button>
        </section>
      </div>
    );
  if (state.kind === "error")
    return (
      <div class="stack">
        <div class="notice err">
          <span class="ic" aria-hidden="true" />
          <span role="alert">{state.message}</span>
        </div>
        <button type="button" class="btn" onClick={() => void load()}>
          {t("account.retry")}
        </button>
      </div>
    );

  const { account, billing, quota, stories } = state.data;
  const { balance } = account;
  const per = TIERS.video.credits;
  const videos = Math.floor(balance.total / per);
  const extra = balance.total - videos * per;
  return (
    <div class="account-grid">
      {banner}
      <section id="credits" class="account-section">
        <h2 class="scene">{t("account.credits")}</h2>
        <p class="big">
          {t(videos === 1 ? "account.videoLeft" : "account.videosLeft", { n: count(videos) })}
        </p>
        {extra > 0 && <p class="small muted">{t("account.extraCredits", { n: count(extra) })}</p>}
        <p class="small muted">{t("account.neverExpire")}</p>
        {billing.paidPaused && (
          <div class="notice warn">
            <span class="ic" aria-hidden="true" />
            <span>{t("account.paused")}</span>
          </div>
        )}
        <div class="kv">
          <span>{t("account.previewsToday")}</span>
          <b>
            {t("account.previewsLeft", {
              n: count(quota.remaining),
              limit: count(quota.limit),
              time: quota.resetAt === null ? "" : clockTime(quota.resetAt),
            })}
          </b>
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="/pricing">
            {t("account.buyVideos")}
          </a>
        </div>
      </section>
      <section id="stories" class="account-section">
        <h2 class="scene">{t("account.stories")}</h2>
        {stories.length === 0 ? (
          <p class="muted">
            {t("account.noStories")} <a href="/">{t("account.makeStory")}</a>
          </p>
        ) : (
          <>
            <p class="small muted">{t("account.storiesText")}</p>
            <ul class="stories">
              {stories.map((story) => (
                <StoryRow key={story.id} story={story} />
              ))}
            </ul>
          </>
        )}
      </section>
      <section id="activity" class="account-section">
        <h2 class="scene">{t("account.activity")}</h2>
        <p class="small muted">{t("account.activityText")}</p>
        <LedgerTable />
      </section>
      <section id="signin" class="account-section">
        <h2 class="scene">{t("account.signin")}</h2>
        <SignInMethods account={account} onSignedOut={signedOut} />
        <button
          type="button"
          class="link"
          onClick={() =>
            void post("/v1/auth/logout").finally(async () => {
              await refreshMe();
              navigate("/");
            })
          }
        >
          {t("account.signOut")}
        </button>
      </section>
      <section id="delete" class="account-section">
        <h2 class="scene">{t("delete.title")}</h2>
        <DeleteAccount
          billing={billing}
          credits={balance.total}
          navigate={navigate}
          onCancelPlan={() => undefined}
        />
      </section>
    </div>
  );
}
