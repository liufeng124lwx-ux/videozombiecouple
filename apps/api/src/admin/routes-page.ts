import type { Context } from "hono";
import { html } from "hono/html";
import { loadRoutes, saveRoute } from "../services/routes-store.ts";
import type { AppEnv } from "../types.ts";
import { audit } from "./audit.ts";
import { page } from "./layout.ts";

export async function routesPage(c: Context<AppEnv>) {
  const routes = await loadRoutes(c.env.DB);
  return c.html(
    page(
      "Routes",
      c.get("adminEmail"),
      html`<p class="note">
          Spec 4.5: the lowest rank runs first; parallel routes at that rank run together. Models
          and prices change in the catalog, after the eval (CLAUDE.md).
        </p>
        <table>
          <tr>
            <th>Route</th>
            <th>Capability</th>
            <th>Mode</th>
            <th>Model</th>
            <th>Cost</th>
            <th>Edit</th>
          </tr>
          ${routes.map(
            (r) =>
              html`<tr>
                <td>${r.id}</td>
                <td>${r.capability}</td>
                <td>${r.mode ?? "—"}</td>
                <td>${r.model}${r.parallel ? " (parallel)" : ""}</td>
                <td>$${r.costUsd}</td>
                <td>
                  <form method="post" action="/admin/routes/${r.id}">
                    <label><input type="checkbox" name="enabled" ${r.enabled ? "checked" : ""} /> on</label>
                    rank <input name="rank" type="number" min="1" value="${r.rank}" style="width:4em" />
                    timeout ms
                    <input name="timeoutMs" type="number" value="${r.timeoutMs}" style="width:7em" />
                    <button>Save</button>
                  </form>
                </td>
              </tr>`,
          )}
        </table>`,
    ),
  );
}

/** Spec 8.1: on/off, order and timeout only; the audit keeps what they were. */
export async function saveRouteForm(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  const before = (await loadRoutes(c.env.DB)).find((r) => r.id === id);
  if (!before) return c.text("No such route", 404);
  const form = await c.req.parseBody();
  const rank = Number.parseInt(String(form.rank ?? ""), 10);
  const timeoutMs = Number.parseInt(String(form.timeoutMs ?? ""), 10);
  if (
    !Number.isInteger(rank) ||
    rank < 1 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 10_000 ||
    timeoutMs > 600_000
  )
    return c.text("Rank must be 1 or more; the timeout between 10 and 600 seconds", 400);
  const patch = { enabled: form.enabled === "on", rank, timeoutMs };
  await saveRoute(c.env.DB, id, patch);
  await audit(
    c.env,
    c.get("adminEmail"),
    "route",
    id,
    { enabled: before.enabled, rank: before.rank, timeoutMs: before.timeoutMs },
    patch,
  );
  return c.redirect("/admin/routes", 303);
}
