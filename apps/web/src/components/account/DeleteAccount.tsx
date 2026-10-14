import "../../styles/dialog.css";
import type { BillingView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useState } from "preact/hooks";
import { ApiError, post } from "../../lib/api.ts";
import { shortDate } from "../../lib/format.ts";
import { refreshMe } from "../../lib/me.ts";
import { messageOf } from "../auth/SignInDialog.tsx";
import Modal from "../Modal.tsx";

type Props = {
  billing: BillingView;
  credits: number;
  onCancelPlan: () => void;
  navigate?: (url: string) => void;
};
type View = "closed" | "cancelFirst" | "confirm";

const PLAN_LABEL = { starter: "Starter", plus: "Plus", max: "Max" } as const;
/** The API refuses to delete while a plan can still bill (spec 5.5). */
const blocks = (billing: BillingView) =>
  billing.subscription?.status === "active" || billing.subscription?.status === "past_due";

/** Design S15: cancel a live plan first; then type DELETE once. */
export default function DeleteAccount({
  billing,
  credits,
  onCancelPlan,
  navigate = (url) => location.assign(url),
}: Props) {
  const [view, setView] = useState<View>("closed");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sub = billing.subscription;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await post("/v1/account/delete", { confirm: "DELETE" });
      await refreshMe();
      navigate("/");
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "SUBSCRIPTION_ACTIVE")
        setView("cancelFirst");
      else setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p class="muted">{t("delete.text")}</p>
      <button
        type="button"
        class="btn btn-danger"
        onClick={() => setView(blocks(billing) ? "cancelFirst" : "confirm")}
      >
        {t("delete.open")}
      </button>
      {view !== "closed" && (
        <Modal labelledBy="delete-title" onClose={() => setView("closed")}>
          {view === "cancelFirst" ? (
            <div class="stack">
              <h2 id="delete-title">{t("delete.cancelFirst.title")}</h2>
              <p class="sub">
                {t("delete.cancelFirst.text", {
                  plan: sub ? PLAN_LABEL[sub.plan] : "",
                  date: sub ? shortDate(sub.periodEnd) : "",
                })}
              </p>
              <button
                type="button"
                class="btn btn-dark btn-block"
                onClick={() => {
                  setView("closed");
                  onCancelPlan();
                }}
              >
                {t("account.cancel")}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-block"
                onClick={() => setView("closed")}
              >
                {t("delete.keep")}
              </button>
            </div>
          ) : (
            <div class="stack">
              <h2 id="delete-title">{t("delete.confirm.title")}</h2>
              <p class="sub">{t("delete.confirm.text")}</p>
              <ul class="bullets">
                <li>{t("delete.confirm.photos")}</li>
                <li>{t("delete.confirm.credits", { n: credits.toLocaleString("en-US") })}</li>
                <li>{t("delete.confirm.signout")}</li>
              </ul>
              <p class="fine">{t("delete.confirm.orders")}</p>
              <label class="field">
                <span>{t("delete.confirm.type")}</span>
                <input
                  value={typed}
                  autoComplete="off"
                  onInput={(e) => setTyped(e.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                class="btn btn-danger solid btn-block"
                disabled={typed !== "DELETE" || busy}
                onClick={() => void remove()}
              >
                {t("delete.confirm.button")}
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-block"
                onClick={() => setView("closed")}
              >
                {t("delete.close")}
              </button>
              {error && (
                <p class="small err-text" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
