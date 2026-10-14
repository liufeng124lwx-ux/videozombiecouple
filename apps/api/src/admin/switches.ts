import { CAPABILITY_IDS } from "@vzc/catalog";
import type { Context } from "hono";
import { html } from "hono/html";
import { forgetFlags, parsePaidLimit, readFlags } from "../middleware/flags.ts";
import { paidLine } from "../ops/budgets.ts";
import { KIE_RESET_LABEL } from "../ops/kie-cap.ts";
import { spendBetween, startOfUtcDay } from "../ops/spend.ts";
import type { AppEnv } from "../types.ts";
import { audit } from "./audit.ts";
import { page } from "./layout.ts";

export async function switches(c: Context<AppEnv>) {
  forgetFlags(c.env.KV);
  const f = await readFlags(c.env.KV);
  // Each pause box carries the value it showed: a save changes a pause only when the admin
  // flipped the box, so a stale form never undoes what ops or the kie cap did meanwhile.
  const box = (name: string, on: boolean, label: string) =>
    html`<input type="hidden" name="shown_${name}" value="${on ? "on" : "off"}" /><label
        ><input type="checkbox" name="${name}" ${on ? "checked" : ""} /> ${label}</label
      ><br />`;
  const day = (t: number | null) =>
    t === null ? "" : new Date(t).toISOString().slice(0, 16).replace("T", " ");
  return c.html(
    page(
      "Switches",
      c.get("adminEmail"),
      html`<form method="post" action="/admin/flags">
        ${box(
          "paused",
          f.paused,
          `Pause all processing (accounts and billing keep working)${f.pausedBy === "kie-cap" ? ` (paused because the kie key's daily limit is used up; lifts at ${KIE_RESET_LABEL})` : ""}`,
        )}
        ${
          f.paused && f.pausedBy === "kie-cap"
            ? html`<label
                  ><input type="checkbox" name="keepPaused" /> Keep paused after the kie limit resets</label
                ><br />`
            : ""
        }
        ${box(
          "freePaused",
          f.freePaused,
          `Pause the free tier${f.freePausedBy === "ops" ? " (paused by the cost breaker; lifts at 00:00 UTC)" : ""}`,
        )}
        ${box(
          "paidPaused",
          f.paidPaused,
          `Pause paid jobs${f.paidPausedBy === "ops" ? ` (paused by the daily budget at ${day(f.paidPausedAt)} UTC; only you can resume)` : f.paidPaused && f.paidPausedAt !== null ? ` (since ${day(f.paidPausedAt)} UTC)` : ""}`,
        )}
        <p>
          <label
            >Today's paid limit (USD)
            <input
              name="paidLimitUsd"
              type="number"
              step="0.01"
              min="0"
              value=""
              size="40"
              placeholder="a number sets today's limit; empty when resuming a budget pause: spent today + one full line"
          /></label>
          ${f.paidLimit && f.paidLimit.day === startOfUtcDay(Date.now()) ? `today's limit: $${f.paidLimit.usd}` : ""}
        </p>
        <p>
          Capabilities offline (no new jobs):<br />
          ${CAPABILITY_IDS.map(
            (id) =>
              html`<label
                ><input type="checkbox" name="offline" value="${id}" ${f.offline.includes(id) ? "checked" : ""} />
                ${id}</label
              > `,
          )}
        </p>
        <p>
          Banner <input name="bannerText" value="${f.banner?.text ?? ""}" size="60" maxlength="160" />
          link <input name="bannerHref" value="${f.banner?.href ?? ""}" size="30" placeholder="/path on the site" />
        </p>
        <button>Save</button>
      </form>`,
    ),
  );
}

/** Spec 8.1 / 4.2: the admin's switches; fields this form doesn't own (the breaker's) are kept. */
export async function saveFlags(c: Context<AppEnv>) {
  const form = await c.req.parseBody({ all: true });
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse((await c.env.KV.get("flags")) ?? "{}") as Record<string, unknown>;
  } catch {}
  const offline = ([] as unknown[])
    .concat(form.offline ?? [])
    .map(String)
    .filter((id) => (CAPABILITY_IDS as readonly string[]).includes(id));
  const text = String(form.bannerText ?? "")
    .trim()
    .slice(0, 160);
  const href = String(form.bannerHref ?? "").trim();
  const now = Date.now();
  const today = startOfUtcDay(now);
  // What the form showed for a box; a form without it (an old tab) counts as showing what is stored.
  const shown = (name: string) =>
    form[`shown_${name}`] === undefined ? stored[name] === true : form[`shown_${name}`] === "on";
  const flipped = (name: string) => (form[name] === "on") !== shown(name);
  const next: Record<string, unknown> = {
    ...stored,
    paused: stored.paused === true,
    freePaused: stored.freePaused === true,
    paidPaused: stored.paidPaused === true,
  };
  if (flipped("paused")) {
    const on = form.paused === "on";
    Object.assign(next, { paused: on, pausedBy: on ? "admin" : null, pausedAt: on ? now : null });
  } else if (form.keepPaused === "on" && stored.paused === true && stored.pausedBy === "kie-cap") {
    // The admin wants the kie-cap pause to outlast kie's reset: it becomes theirs.
    next.pausedBy = "admin";
  }
  if (flipped("freePaused")) {
    const on = form.freePaused === "on";
    Object.assign(next, { freePaused: on, freePausedBy: on ? "admin" : null });
  }
  let paidLimit = parsePaidLimit(stored.paidLimit);
  const typed = Number.parseFloat(String(form.paidLimitUsd ?? ""));
  if (flipped("paidPaused")) {
    const on = form.paidPaused === "on";
    // Resuming the budget's own pause without a number: one more full line on top of today's spend.
    if (!on && stored.paidPaused === true && stored.paidPausedBy === "ops" && !(typed > 0)) {
      const spent = await spendBetween(c.env, today, undefined, "paid");
      paidLimit = { day: today, usd: spent + (await paidLine(c.env, now, {})) };
    }
    Object.assign(next, {
      paidPaused: on,
      paidPausedBy: on ? "admin" : null,
      paidPausedAt: on ? now : null,
    });
  }
  if (Number.isFinite(typed) && typed > 0) paidLimit = { day: today, usd: typed };
  Object.assign(next, {
    paidLimit,
    banner: text ? { text, href: /^\/(?!\/)/.test(href) ? href : null } : null,
    offline,
  });
  await c.env.KV.put("flags", JSON.stringify(next));
  forgetFlags(c.env.KV);
  await audit(c.env, c.get("adminEmail"), "flags", "flags", stored, next);
  return c.redirect("/admin", 303);
}
