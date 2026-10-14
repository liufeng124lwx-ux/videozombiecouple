import type { LedgerEntryView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { api } from "../../lib/api.ts";
import { dateTime } from "../../lib/format.ts";
import { ledgerAmount, ledgerLabel } from "../../lib/ledger.ts";
import { messageOf } from "../auth/SignInDialog.tsx";

type Page = { entries: LedgerEntryView[]; next: number | null };

/** Spec 5.5: the balance ledger in videos, 20 rows a page, newest first; the API pages by row id. */
export default function LedgerTable() {
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursor = cursors[cursors.length - 1] ?? null;

  useEffect(() => {
    let live = true;
    setPage(null);
    setError(null);
    api<Page>(`/v1/account/ledger${cursor === null ? "" : `?before=${cursor}`}`)
      .then((next) => live && setPage(next))
      .catch((failure: unknown) => live && setError(messageOf(failure)));
    return () => {
      live = false;
    };
  }, [cursor]);

  if (error)
    return (
      <p class="small err-text" role="alert">
        {error}
      </p>
    );
  if (!page) return <p class="muted small">{t("account.loading")}</p>;
  if (page.entries.length === 0 && cursors.length === 1)
    return <p class="muted">{t("account.noActivity")}</p>;
  return (
    <div>
      <table class="ledger">
        <thead>
          <tr>
            <th>{t("account.when")}</th>
            <th>{t("account.what")}</th>
            <th>{t("account.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {page.entries.map((entry) => (
            <tr key={entry.id}>
              <td>{dateTime(entry.createdAt)}</td>
              <td>{ledgerLabel(entry)}</td>
              <td class={entry.delta > 0 ? "plus" : "minus"}>{ledgerAmount(entry.delta)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="pager">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={cursors.length === 1}
          onClick={() => setCursors((list) => list.slice(0, -1))}
        >
          {t("account.newer")}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={page.next === null}
          onClick={() => setCursors((list) => [...list, page.next])}
        >
          {t("account.older")}
        </button>
      </div>
    </div>
  );
}
