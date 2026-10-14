import type { Context } from "hono";
import { html } from "hono/html";
import { presign } from "../services/r2-presign.ts";
import type { AppEnv } from "../types.ts";
import { page } from "./layout.ts";
import { when } from "./users.ts";

type Row = Record<string, unknown>;
type Attempt = {
  id?: string;
  model?: string;
  role?: string;
  state?: string;
  taskId?: string | null;
  costUsd?: number | null;
  failKind?: string | null;
  failMsg?: string | null;
  finishedAt?: number | null;
};
const LINK_SEC = 3600;

/** Spec 8.1: look a story up by its id or by a kie task id from one of its attempts. */
export async function jobs(c: Context<AppEnv>) {
  const q = (c.req.query("q") ?? "").trim();
  const task = q.replace(/["%_\\]/g, "");
  const results = q
    ? (
        await c.env.DB.prepare(
          "SELECT id, owner, kind || ' · ' || scene AS capability, status, created_at FROM stories WHERE id=? OR (? != '' AND steps LIKE ?) ORDER BY created_at DESC LIMIT 20",
        )
          .bind(q, task, `%"taskId":"${task}"%`)
          .all<Row>()
      ).results
    : [];
  return c.html(
    page(
      "Stories",
      c.get("adminEmail"),
      html`<form>
          <input name="q" value="${q}" placeholder="story id or kie task id" size="40" autofocus />
          <button>Find</button>
        </form>
        <table>
          <tr>
            <th>Story</th>
            <th>Owner</th>
            <th>Kind · scene</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
          ${results.map(
            (j) =>
              html`<tr>
                <td><a href="/admin/jobs/${String(j.id)}">${String(j.id)}</a></td>
                <td>${String(j.owner)}</td>
                <td>${String(j.capability)}</td>
                <td>${String(j.status)}</td>
                <td>${when(j.created_at)}</td>
              </tr>`,
          )}
        </table>`,
    ),
  );
}

/** Spec 8.1: every step and attempt, and while the story is kept, signed links to its files. */
export async function job(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const row = await c.env.DB.prepare("SELECT * FROM stories WHERE id=?").bind(id).first<Row>();
  if (!row) return c.text("No such story", 404);
  let attempts: Attempt[] = [];
  try {
    const steps = JSON.parse(String(row.steps ?? "[]")) as { id: string; attempts: Attempt[] }[];
    attempts = steps.flatMap((step) =>
      step.attempts.map((a, i) => ({ ...a, id: `${step.id} #${i + 1}`, role: step.id })),
    );
  } catch {}
  const live = row.status !== "expired" && Number(row.expires_at) > Date.now();
  const files: { key: string; url: string }[] = [];
  if (live) {
    const keys: string[] = [];
    for (const prefix of [`keep/${id}/`, `kf/${id}/`, `shot/${id}/`, `out/${id}/`])
      for (const object of (await c.env.BUCKET.list({ prefix })).objects)
        if (!keys.includes(object.key)) keys.push(object.key);
    for (const key of keys) files.push({ key, url: await presign(c.env, key, "GET", LINK_SEC) });
  }
  return c.html(
    page(
      `Story ${id}`,
      c.get("adminEmail"),
      html`<p>
          ${String(row.kind)} · ${String(row.scene)} · <b>${String(row.status)}</b>
          ${String(row.error_code ?? "")} · owner ${String(row.owner)} · created
          ${when(row.created_at)} · expires ${when(row.expires_at)}
        </p>
        <p>cost <code>$${String(row.cost_usd)}</code> · picks <code>${String(row.picks)}</code></p>
        <h2>Attempts</h2>
        <table>
          <tr>
            <th>Attempt</th>
            <th>Model</th>
            <th>Step</th>
            <th>State</th>
            <th>kie task</th>
            <th>Cost</th>
            <th>Failure</th>
            <th>Finished</th>
          </tr>
          ${attempts.map(
            (a) =>
              html`<tr>
                <td>${a.id ?? ""}</td>
                <td>${a.model ?? ""}</td>
                <td>${a.role ?? ""}</td>
                <td>${a.state ?? ""}</td>
                <td>${a.taskId ?? ""}</td>
                <td>${a.costUsd ?? ""}</td>
                <td>${a.failKind ?? ""} ${a.failMsg ?? ""}</td>
                <td>${when(a.finishedAt)}</td>
              </tr>`,
          )}
        </table>
        <h2>Ban</h2>
        <p class="note">Bans the identities stored on this story (raw ids are never kept).</p>
        ${(
          [
            ["visitor", row.visitor_hash],
            ["device", row.fp_hash],
            ["ip", row.ip_hash],
          ] as const
        )
          .filter(([, hash]) => typeof hash === "string" && hash !== "anon")
          .map(
            ([kind, hash]) =>
              html`<form method="post" action="/admin/bans">
                <input type="hidden" name="kind" value="${kind}" />
                <input type="hidden" name="hash" value="${String(hash)}" />
                <input type="hidden" name="job" value="${id}" />
                Ban this ${kind} for
                <input name="days" type="number" value="30" min="1" max="3650" style="width:5em" />
                days, reason <input name="reason" required size="30" /> <button>Ban</button>
              </form>`,
          )}
        <h2>Files</h2>
        ${
          live
            ? html`<p class="note">Links work for an hour.</p>
              <ul>
                ${files.map(
                  (f) =>
                    html`<li><a href="${f.url}" rel="noreferrer" target="_blank">${f.key}</a></li>`,
                )}
              </ul>`
            : html`<p class="note">Expired: the files are gone.</p>`
        }`,
    ),
  );
}
