import type { MeView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { onAccountChanged, onSignedIn, openSignIn } from "../../lib/bus.ts";
import { loadMe, refreshMe } from "../../lib/me.ts";
import { signedInHint } from "../../lib/session.ts";

type State =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "member"; email: string; credits: number };

const stateOf = (me: MeView | null): State =>
  me?.user ? { kind: "member", email: me.user.email, credits: me.credits ?? 0 } : { kind: "guest" };

/** Design S17: credits for members (links to /account), Sign in for everyone else. */
export default function AccountChip() {
  const [state, setState] = useState<State>(() =>
    signedInHint() ? { kind: "loading" } : { kind: "guest" },
  );

  useEffect(() => {
    const update = () => {
      void refreshMe().then((me) => setState(stateOf(me)));
    };
    void loadMe().then((me) => setState(stateOf(me)));
    const stopSignIn = onSignedIn(update);
    const stopChange = onAccountChanged(update);
    return () => {
      stopSignIn();
      stopChange();
    };
  }, []);

  if (state.kind === "loading") return <span class="chip" aria-busy="true" />;
  if (state.kind === "guest")
    return (
      <button type="button" class="btn btn-ghost" onClick={() => openSignIn()}>
        {t("nav.signIn")}
      </button>
    );
  return (
    <a class="chip account-chip" href="/account" title={t("chip.account")}>
      <span aria-hidden="true">⚡</span>{" "}
      {t("chip.credits", { n: state.credits.toLocaleString("en-US") })}
      <span class="avatar" aria-hidden="true">
        {state.email.slice(0, 1).toUpperCase()}
      </span>
    </a>
  );
}
