import type { MeView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { onAccountChanged, onSignedIn, openSignIn } from "../../lib/bus.ts";
import { loadMe, refreshMe } from "../../lib/me.ts";
import { signedInHint } from "../../lib/session.ts";
import { getStory } from "../../lib/story/client.ts";
import { rememberedStory } from "../../lib/story/resume.ts";

type State =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "member"; email: string; credits: number };

const stateOf = (me: MeView | null): State =>
  me?.user ? { kind: "member", email: me.user.email, credits: me.credits ?? 0 } : { kind: "guest" };

const RENDER_POLL_MS = 30_000;

/** The film this browser started, while it renders: a way back to it from any other page. */
function useRendering(): { id: string; etaMs: number | null } | null {
  const [rendering, setRendering] = useState<{ id: string; etaMs: number | null } | null>(null);
  useEffect(() => {
    const id = rememberedStory();
    if (!id || new URLSearchParams(location.search).get("id") === id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const view = await getStory(id).catch(() => null);
      if (!alive) return;
      if (view?.status !== "rendering") return setRendering(null);
      setRendering({ id, etaMs: view.progress?.etaMs ?? null });
      timer = setTimeout(check, RENDER_POLL_MS);
    };
    void check();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return rendering;
}

/**
 * Design S17: credits for members (links to /account), Sign in for everyone else; members also get
 * My films, and anyone whose film is rendering gets a live link back to it.
 */
export default function AccountChip() {
  // The first render matches the server's (which has no cookies), so hydration never mixes the
  // two: a Sign in button left beside a member's credits. The cookie is read after mounting.
  const [state, setState] = useState<State>({ kind: "loading" });
  const rendering = useRendering();

  useEffect(() => {
    const update = () => {
      void refreshMe().then((me) => setState(stateOf(me)));
    };
    if (!signedInHint()) setState({ kind: "guest" });
    void loadMe().then((me) => setState(stateOf(me)));
    const stopSignIn = onSignedIn(update);
    const stopChange = onAccountChanged(update);
    return () => {
      stopSignIn();
      stopChange();
    };
  }, []);

  const live = rendering && (
    <a class="chip rendering-chip" href={`/story?id=${encodeURIComponent(rendering.id)}`}>
      <span class="rec-dot" aria-hidden="true" />
      {t("nav.rendering")}
      {rendering.etaMs !== null && rendering.etaMs > 60_000
        ? ` · ${Math.ceil(rendering.etaMs / 60_000)} min`
        : ""}
    </a>
  );
  if (state.kind === "loading")
    return (
      <>
        {live}
        <span class="chip" aria-busy="true" />
      </>
    );
  if (state.kind === "guest")
    return (
      <>
        {live}
        <button type="button" class="btn btn-ghost" onClick={() => openSignIn()}>
          {t("nav.signIn")}
        </button>
      </>
    );
  return (
    <>
      {live}
      <a class="hdr-films" href="/account#stories">
        {t("nav.films")}
      </a>
      <a class="chip account-chip" href="/account" title={t("chip.account")}>
        <span aria-hidden="true">⚡</span>{" "}
        {t("chip.credits", { n: state.credits.toLocaleString("en-US") })}
        <span class="avatar" aria-hidden="true">
          {state.email.slice(0, 1).toUpperCase()}
        </span>
      </a>
    </>
  );
}
