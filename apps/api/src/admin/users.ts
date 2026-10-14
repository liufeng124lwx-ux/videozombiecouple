import type { Context } from "hono";
import { html } from "hono/html";
import type { AppEnv } from "../types.ts";
import { audit } from "./audit.ts";
import { page } from "./layout.ts";

type Row = Record<string, unknown>;
const MAX_ADJUST = 10_000;
export const when = (t: unknown) =>
  typeof t === "number" && t > 0 ? new Date(t).toISOString().replace("T", " ").slice(0, 16) : "—";

/** A plain table of the given columns; every cell goes through `html`, so it is escaped. */
export const table = (list: Row[], cols: string[]) =>
  html`<table>
    <tr>
      ${cols.map((col) => html`<th>${col}</th>`)}
    </tr>
    ${list.map(
      (r) =>
        html`<tr>
          ${cols.map((col) => html`<td>${/(_at|_end)$/.test(col) ? when(r[col]) : String(r[col] ?? "—")}</td>`)}
        </tr>`,
    )}
  </table>`;

export async function users(c: Context<AppEnv>) {
  const q = (c.req.query("q") ?? "").trim();
  const results = q
    ? (
        await c.env.DB.prepare(
          "SELECT id, email, created_at FROM users WHERE id=? OR email LIKE ? ORDER BY created_at DESC LIMIT 50",
        )
          .bind(q, `%${q.replace(/[%_]/g, "")}%`)
          .all<Row>()
      ).results
    : [];
  return c.html(
    page(
      "Users",
      c.get("adminEmail"),
      html`<form>
          <input name="q" value="${q}" placeholder="email or user id" autofocus />
          <button>Search</button>
        </form>
        <table>
          <tr>
            <th>User</th>
            <th>Email</th>
            <th>Joined</th>
          </tr>
          ${results.map(
            (u) =>
              html`<tr>
                <td><a href="/admin/users/${String(u.id)}">${String(u.id)}</a></td>
                <td>${String(u.email)}</td>
                <td>${when(u.created_at)}</td>
              </tr>`,
          )}
        </table>`,
    ),
  );
}

export async function user(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const profile = await c.env.DB.prepare("SELECT * FROM users WHERE id=?").bind(id).first<Row>();
  if (!profile) return c.text("No such user", 404);
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(id));
  const balance = await wallet.balance(id);
  const all = async (sql: string) => (await c.env.DB.prepare(sql).bind(id).all<Row>()).results;
  const buckets = await all(
    "SELECT id, kind, granted, remaining, expires_at, source_ref, created_at FROM credit_buckets WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
  );
  const ledger = await all(
    "SELECT created_at, delta, type, reason, job_id, order_id FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT 50",
  );
  const subs = await all(
    "SELECT plan_key, interval, status, current_period_end FROM subscriptions WHERE user_id=?",
  );
  const orders = await all(
    "SELECT id, product_key, amount, currency, status, refunded_amount, created_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
  );
  const jobs = await all(
    "SELECT id, kind || ' · ' || scene AS capability, status, error_code, created_at FROM stories WHERE owner='u:' || ? ORDER BY created_at DESC LIMIT 20",
  );
  const actor = c.get("adminEmail");
  return c.html(
    page(
      `User ${id}`,
      actor,
      html`<p>
          <b>${String(profile.email ?? "")}</b> · joined ${when(profile.created_at)}
          ${profile.deleted_at ? html` · <b>deleted</b> ${when(profile.deleted_at)}` : ""}
          · balance <b>${balance.total}</b>
        </p>
        <form method="post" action="/admin/users/${id}/credits">
          <input type="hidden" name="nonce" value="${crypto.randomUUID()}" />
          Adjust credits <input name="delta" type="number" required style="width:6em" /> reason
          <input name="reason" required size="40" /> <button>Apply</button>
          <span class="note">positive adds an admin bucket; negative takes credits away (never below zero)</span>
        </form>
        <form method="post" action="/admin/users/${id}/cap">
          Daily credit cap
          <input name="cap" type="number" min="0" value="${profile.daily_credit_cap ?? ""}" />
          <button>Save</button><span class="note">empty = catalog default</span>
        </form>
        <h2>Credit buckets</h2>
        ${table(buckets, ["id", "kind", "granted", "remaining", "expires_at", "source_ref", "created_at"])}
        <h2>Ledger</h2>
        ${table(ledger, ["created_at", "delta", "type", "reason", "job_id", "order_id"])}
        <h2>Subscriptions</h2>
        ${table(subs, ["plan_key", "interval", "status", "current_period_end"])}
        <h2>Orders</h2>
        ${table(orders, ["id", "product_key", "amount", "currency", "status", "refunded_amount", "created_at"])}
        <h2>Jobs</h2>
        <table>
          <tr>
            <th>Job</th>
            <th>Capability</th>
            <th>Status</th>
            <th>Error</th>
            <th>Created</th>
          </tr>
          ${jobs.map(
            (j) =>
              html`<tr>
                <td><a href="/admin/jobs/${String(j.id)}">${String(j.id)}</a></td>
                <td>${String(j.capability)}</td>
                <td>${String(j.status)}</td>
                <td>${String(j.error_code ?? "")}</td>
                <td>${when(j.created_at)}</td>
              </tr>`,
          )}
        </table>`,
    ),
  );
}

/** Spec 8.1: add or take credits, always with a reason; one form (nonce) applies at most once. */
export async function adjustCredits(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const form = await c.req.parseBody();
  const delta = Number.parseInt(String(form.delta ?? ""), 10);
  const reason = String(form.reason ?? "")
    .trim()
    .slice(0, 200);
  const nonce = String(form.nonce ?? "").slice(0, 64);
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST || !reason || !nonce)
    return c.text("A non-zero delta within ±10000 and a reason are required", 400);
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
  if (!exists) return c.text("No such user", 404);
  // Claimed before the wallet is touched: a double-clicked form applies once.
  const claim = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO admin_nonces(nonce, created_at) VALUES(?, ?)",
  )
    .bind(`credits:${id}:${nonce}`, Date.now())
    .run();
  if (claim.meta.changes === 0) return c.redirect(`/admin/users/${id}`, 303);
  const wallet = c.env.WALLET.get(c.env.WALLET.idFromName(id));
  const before = (await wallet.balance(id)).total;
  const actor = c.get("adminEmail");
  // The person sees this ledger line in their account: who and why stay in admin_audit.
  const note = "admin";
  let debt = 0;
  if (delta > 0)
    await wallet.grant(id, {
      kind: "admin",
      credits: delta,
      expiresAt: null,
      sourceRef: `admin:${nonce}`,
      reason: note,
    });
  else {
    const taken = await wallet.clawback(id, {
      credits: -delta,
      sourcePrefix: "admin:",
      orderId: `admin:${nonce}`,
      reason: note,
      type: "admin_adjust",
    });
    // What couldn't be taken is owed, the same rule as refunds (billing/apply.ts).
    debt = taken.debt;
    if (debt > 0)
      await c.env.DB.prepare("UPDATE users SET refund_debt = refund_debt + ? WHERE id=?")
        .bind(debt, id)
        .run();
  }
  const after = (await wallet.balance(id)).total;
  await audit(
    c.env,
    actor,
    "credits",
    id,
    { balance: before },
    { balance: after, delta, debt, reason, nonce },
  );
  return c.redirect(`/admin/users/${id}`, 303);
}

/** Cost guardrails spec 4: an account's own daily credit cap; empty goes back to the catalog default. */
export async function saveDailyCap(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const raw = String((await c.req.parseBody()).cap ?? "").trim();
  const cap = raw === "" ? null : Number(raw);
  if (cap !== null && (!Number.isInteger(cap) || cap < 0))
    return c.text("The cap is a whole number of credits, or empty", 400);
  const before = await c.env.DB.prepare("SELECT daily_credit_cap AS cap FROM users WHERE id=?")
    .bind(id)
    .first<{ cap: number | null }>();
  if (!before) return c.text("No such user", 404);
  await c.env.DB.prepare("UPDATE users SET daily_credit_cap=? WHERE id=?").bind(cap, id).run();
  await audit(c.env, c.get("adminEmail"), "daily_cap", id, { cap: before.cap }, { cap });
  return c.redirect(`/admin/users/${id}`, 303);
}
