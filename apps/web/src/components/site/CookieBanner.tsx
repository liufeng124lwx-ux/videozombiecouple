import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { applyConsent, track } from "../../lib/analytics.ts";
import { type Consent, needsBanner, saveConsent, storedConsent } from "../../lib/consent.ts";
import { loadMe } from "../../lib/me.ts";

/** Spec 7.5 / design S17: bottom of the screen, Reject and Accept look the same, about 3KB. */
export default function CookieBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void loadMe().then((me) => setOpen(needsBanner(storedConsent(), me?.consentRequired ?? true)));
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-cookie-settings]"))
        setOpen(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  function choose(choice: Consent) {
    saveConsent(choice);
    applyConsent(choice);
    if (choice === "granted") track("consent");
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div class="cookie" role="dialog" aria-label={t("cookie.label")}>
      <p>
        {t("cookie.text")} <a href="/privacy#cookies">{t("cookie.details")}</a>
      </p>
      <div class="cookie-actions">
        <button type="button" class="btn btn-sm" onClick={() => choose("denied")}>
          {t("cookie.reject")}
        </button>
        <button type="button" class="btn btn-sm" onClick={() => choose("granted")}>
          {t("cookie.accept")}
        </button>
      </div>
    </div>
  );
}
