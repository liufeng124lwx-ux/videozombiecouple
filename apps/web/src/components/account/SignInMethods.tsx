import type { AccountView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useState } from "preact/hooks";
import { ApiError, apiOrigin, post } from "../../lib/api.ts";
import { messageOf } from "../auth/SignInDialog.tsx";

type Props = { account: AccountView; onSignedOut: () => void };

/** Spec 5.5: connect Google, set or change a password; the emailed code always works. */
export default function SignInMethods({ account, onSignedOut }: Props) {
  const [editing, setEditing] = useState(false);
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPassword, setHasPassword] = useState(account.hasPassword);

  async function save(event: Event) {
    event.preventDefault();
    setError(null);
    try {
      await post("/v1/account/password", { password });
      setHasPassword(true);
      setSaved(true);
      setEditing(false);
      setPassword("");
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "UNAUTHORIZED") onSignedOut();
      else setError(messageOf(failure));
    }
  }

  return (
    <div class="methods">
      <div class="kv">
        <span>
          {t("account.google")} · {account.email}
        </span>
        {account.google ? (
          <b>{t("account.connected")}</b>
        ) : (
          <a href={`${apiOrigin()}/auth/google/start?next=${encodeURIComponent("/account")}`}>
            {t("account.connect")}
          </a>
        )}
      </div>
      <div class="kv">
        <span>
          {t("account.emailCode")} · {account.email}
        </span>
        <b>{t("account.on")}</b>
      </div>
      <div class="kv">
        <span>{t("account.password")}</span>
        <button
          type="button"
          class="link"
          onClick={() => {
            setEditing(!editing);
            setSaved(false);
          }}
        >
          {hasPassword ? t("account.changePassword") : t("account.setPassword")}
        </button>
      </div>
      {editing && (
        <form class="actions" onSubmit={(e) => void save(e)}>
          <label class="field inline">
            <span>{t("account.newPassword")}</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
          <button type="submit" class="btn btn-sm">
            {t("account.savePassword")}
          </button>
        </form>
      )}
      {saved && <p class="small ok-text">{t("account.passwordSaved")}</p>}
      {error && (
        <p class="small err-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
