import { WITHDRAWAL_WAIVER_VERSION } from "@vzc/contracts";
import { localePath, t } from "@vzc/i18n";
import { useEffect, useRef, useState } from "preact/hooks";
import { gaClientId, track } from "../../lib/analytics.ts";
import { ApiError, post } from "../../lib/api.ts";
import { onSignedIn, openSignIn } from "../../lib/bus.ts";
import { rememberCheckout } from "../../lib/checkout.ts";
import { loadMe, refreshMe } from "../../lib/me.ts";
import { messageOf } from "../auth/SignInDialog.tsx";

const WAIVER_KEY = "vzc-waiver";

/** The tab's acknowledgement, read when the purchase happens (it may resume after a sign-in). */
function waivedNow(): boolean {
  try {
    return sessionStorage.getItem(WAIVER_KEY) === WITHDRAWAL_WAIVER_VERSION;
  } catch {
    return false;
  }
}

type Props = {
  productKey: string;
  label: string;
  primary?: boolean;
  navigate?: (url: string) => void;
  returnPath?: string;
};

/** Spec 6.4: sign in first if needed, then straight to Stripe Checkout; the API adds ?paid=1 to the way back. */
export default function BuyButton({
  productKey,
  label,
  primary = false,
  returnPath = localePath("/pricing"),
  navigate = (url) => location.assign(url),
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  // Kept for the tab, so a sign-in or a return to this page doesn't ask twice.
  const [waived, setWaived] = useState(() => {
    try {
      return sessionStorage.getItem(WAIVER_KEY) === WITHDRAWAL_WAIVER_VERSION;
    } catch {
      return false;
    }
  });
  const waiting = useRef(false);

  async function checkout(fresh: boolean) {
    setBusy(true);
    setError(null);
    setHasPlan(false);
    try {
      if (!waivedNow()) return;
      const me = fresh ? await refreshMe() : await loadMe();
      if (!me?.user) {
        waiting.current = true;
        const back = new URL(returnPath, location.origin);
        back.searchParams.set("buy", productKey);
        openSignIn({ heading: t("pricing.signInToBuy"), next: `${back.pathname}${back.search}` });
        return;
      }
      track("checkout_start", { product: productKey });
      rememberCheckout(me.credits ?? 0);
      const clientId = gaClientId();
      const { url } = await post<{ url: string }>("/v1/billing/checkout", {
        productKey,
        returnPath,
        ...(clientId ? { clientId } : {}),
        waiver: WITHDRAWAL_WAIVER_VERSION,
      });
      navigate(url);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "SUBSCRIPTION_ACTIVE") setHasPlan(true);
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(location.search).get("buy") === productKey) {
      history.replaceState(null, "", location.pathname);
      void checkout(true);
    }
    return onSignedIn(() => {
      if (!waiting.current) return;
      waiting.current = false;
      void checkout(true);
    });
  }, []);

  return (
    <div class="buy">
      <label class="consent small">
        <input
          type="checkbox"
          checked={waived}
          onChange={(e) => {
            const on = e.currentTarget.checked;
            setWaived(on);
            try {
              if (on) sessionStorage.setItem(WAIVER_KEY, WITHDRAWAL_WAIVER_VERSION);
              else sessionStorage.removeItem(WAIVER_KEY);
            } catch {}
          }}
        />
        <span>{t("pricing.waiver")}</span>
      </label>
      <button
        type="button"
        class={primary ? "btn btn-primary" : "btn"}
        disabled={busy || !waived}
        onClick={() => void checkout(false)}
      >
        {label}
      </button>
      {hasPlan && (
        <p class="small muted">
          {t("pricing.hasPlan")} <a href={localePath("/account")}>{t("pricing.toAccount")}</a>
        </p>
      )}
      {error && (
        <p class="small err-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
