import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { track } from "../../lib/analytics.ts";
import { notifyAccountChanged } from "../../lib/bus.ts";
import { clearCheckout, pendingCheckout } from "../../lib/checkout.ts";
import { refreshMe } from "../../lib/me.ts";

export const POLL_MS = 2_000;
export const POLL_LIMIT_MS = 60_000;

type State =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "done"; added: number }
  | { kind: "slow" };

/** Spec 6.4: the webhook may land after the buyer; check the balance every 2 s for up to 60 s. */
export default function CheckoutReturn() {
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (new URLSearchParams(location.search).get("paid") !== "1") return undefined;
    history.replaceState(null, "", location.pathname);
    const before = pendingCheckout()?.credits ?? 0;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState({ kind: "confirming" });

    const tick = async () => {
      const credits = (await refreshMe())?.credits ?? 0;
      if (stopped) return;
      const seconds = Math.round((Date.now() - started) / 1000);
      if (credits > before) {
        clearCheckout();
        setState({ kind: "done", added: credits - before });
        track("checkout_return", { seconds, ok: true });
        notifyAccountChanged();
        return;
      }
      if (Date.now() - started >= POLL_LIMIT_MS) {
        setState({ kind: "slow" });
        track("checkout_return", { seconds, ok: false });
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  if (state.kind === "idle") return null;
  const text =
    state.kind === "confirming"
      ? t("checkout.confirming")
      : state.kind === "done"
        ? t("checkout.added", { n: state.added.toLocaleString("en-US") })
        : t("checkout.slow");
  return (
    <div class="wrap">
      <div class={state.kind === "done" ? "notice ok" : "notice"}>
        <span class="ic" aria-hidden="true" />
        <span role="status">{text}</span>
      </div>
    </div>
  );
}
