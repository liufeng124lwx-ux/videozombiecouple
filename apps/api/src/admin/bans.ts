import type { Context } from "hono";
import { html } from "hono/html";
import { ipSegment } from "../middleware/identity.ts";
import { hashIdentity } from "../services/crypto.ts";
import type { AppEnv, Bindings } from "../types.ts";
import { audit } from "./audit.ts";
import { page } from "./layout.ts";
import { when } from "./users.ts";

const KINDS = ["ip", "device", "visitor", "account"] as const;
type Kind = (typeof KINDS)[number];
const DAY = 86_400_000;

/** The same hashes the identity and ban middleware compute (spec 7.1); accounts are their id. */
async function hashFor(env: Bindings, kind: Kind, value: string): Promise<string> {
  if (kind === "account") return value;
  if (kind === "ip") return hashIdentity(`ip:${ipSegment(value)}`, env.HMAC_KEY);
  return hashIdentity(`${kind}:${value}`, env.HMAC_KEY);
}

export async function bansPage(c: Context<AppEnv>) {
  // Bans keep only hashes; the audit row that made each one says what was banned.
  const { results } = await c.env.DB.prepare(
    `SELECT b.id, b.hash, b.kind, b.expires, b.reason,
       (SELECT a.target FROM admin_audit a WHERE a.action='ban' AND json_extract(a.after, '$.hash')=b.hash ORDER BY a.id DESC LIMIT 1) AS target
     FROM bans b WHERE b.expires>? ORDER BY b.id DESC LIMIT 200`,
  )
    .bind(Date.now())
    .all<{
      id: number;
      hash: string;
      kind: string;
      expires: number;
      reason: string;
      target: string | null;
    }>();
  return c.html(
    page(
      "Bans",
      c.get("adminEmail"),
      html`<form method="post" action="/admin/bans">
          <select name="kind">
            ${KINDS.map((k) => html`<option value="${k}">${k}</option>`)}
          </select>
          <input name="value" required placeholder="IP, device id, visitor id or user id" size="36" />
          days <input name="days" type="number" value="30" min="1" max="3650" style="width:5em" />
          reason <input name="reason" required size="30" /> <button>Ban</button>
          <p class="note">
            IPs are banned by segment (IPv4 /24, IPv6 /64). A lifted ban can take a minute to stop
            applying.
          </p>
        </form>
        <table>
          <tr>
            <th>Kind</th>
            <th>Banned</th>
            <th>Until</th>
            <th>Reason</th>
            <th></th>
          </tr>
          ${results.map(
            (b) =>
              html`<tr>
                <td>${b.kind}</td>
                <td>${b.target ?? html`<code>${b.hash}</code>`}</td>
                <td>${when(b.expires)}</td>
                <td>${b.reason}</td>
                <td>
                  <form class="inline" method="post" action="/admin/bans/${b.id}/delete">
                    <button>Lift</button>
                  </form>
                </td>
              </tr>`,
          )}
        </table>`,
    ),
  );
}

/** Spec 7.1 / 8.1: a ban with a reason and an end date. */
export async function addBan(c: Context<AppEnv>) {
  const form = await c.req.parseBody();
  const kind = String(form.kind ?? "") as Kind;
  const value = String(form.value ?? "").trim();
  // From a job page: the identity hashes stored on the job (raw ids are never kept, spec 7.1).
  const stored = String(form.hash ?? "").trim();
  const days = Number.parseInt(String(form.days ?? ""), 10);
  const reason = String(form.reason ?? "")
    .trim()
    .slice(0, 200);
  if (
    !KINDS.includes(kind) ||
    !(value || stored) ||
    !reason ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3650
  )
    return c.text("A kind, a value, 1–3650 days and a reason are required", 400);
  if (stored) {
    // hashIdentity: 8 bytes of HMAC, base64url.
    if (kind === "account" || !/^[A-Za-z0-9_-]{11}$/.test(stored))
      return c.text("That is not a stored identity hash", 400);
    const expires = Date.now() + days * DAY;
    await c.env.DB.prepare("INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)")
      .bind(stored, kind, expires, reason)
      .run();
    const job = String(form.job ?? "").slice(0, 40);
    await audit(c.env, c.get("adminEmail"), "ban", `${kind} of job ${job}`, null, {
      hash: stored,
      expires,
      reason,
    });
    return c.redirect("/admin/bans", 303);
  }
  // An IP that doesn't parse lands in the "unknown" segment: banning it would ban everyone there.
  if (kind === "ip" && ipSegment(value) === "unknown")
    return c.text("That is not an IPv4 or IPv6 address", 400);
  // A visitor id the identity middleware would never accept could never match.
  if (kind === "visitor" && !/^[a-f0-9]{32}$/.test(value))
    return c.text("A visitor id is 32 hex characters (the vid cookie)", 400);
  const hash = await hashFor(c.env, kind, value);
  const expires = Date.now() + days * DAY;
  await c.env.DB.prepare("INSERT INTO bans(hash,kind,expires,reason) VALUES(?,?,?,?)")
    .bind(hash, kind, expires, reason)
    .run();
  const target = `${kind}:${kind === "ip" ? ipSegment(value) : value}`;
  await audit(c.env, c.get("adminEmail"), "ban", target, null, { hash, expires, reason });
  return c.redirect("/admin/bans", 303);
}

export async function removeBan(c: Context<AppEnv>) {
  const id = Number.parseInt(c.req.param("id") ?? "", 10);
  const row = await c.env.DB.prepare("SELECT * FROM bans WHERE id=?")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) return c.text("No such ban", 404);
  await c.env.DB.prepare("DELETE FROM bans WHERE id=?").bind(id).run();
  await audit(c.env, c.get("adminEmail"), "unban", String(row.hash), row, null);
  return c.redirect("/admin/bans", 303);
}
