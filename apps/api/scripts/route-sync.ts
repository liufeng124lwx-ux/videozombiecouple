/**
 * Plan 7C, run on every deploy: the catalog's routes into D1. Catalog columns follow the catalog;
 * enabled, rank and timeout_ms are the admin's (plan 7B) and only take the seed on insert. Routes
 * the catalog dropped are deleted.
 *
 *   pnpm --filter @vzc/api route-sync /tmp/routes.sql
 *   wrangler d1 execute DB --remote --file /tmp/routes.sql
 */
import { writeFileSync } from "node:fs";
import { type Route, seedRoutes } from "@vzc/providers";

const q = (value: string | null) => (value === null ? "NULL" : `'${value.replace(/'/g, "''")}'`);

const CATALOG_COLUMNS = [
  "capability",
  "mode",
  "parallel",
  "provider",
  "model",
  "params",
  "pad_aspect",
  "credits_tier",
  "aspects",
  "cost_usd",
  "label",
  "updated_at",
];

export function routeSyncSql(seeds: Route[], now = Date.now()): string {
  const update = CATALOG_COLUMNS.map((column) => `${column}=excluded.${column}`).join(", ");
  const rows = seeds.map((r) => {
    const values = [
      q(r.id),
      q(r.capability),
      q(r.mode),
      r.rank,
      r.parallel ? 1 : 0,
      q(r.provider),
      q(r.model),
      q(JSON.stringify(r.params)),
      r.timeoutMs,
      r.padAspect ? 1 : 0,
      q(r.creditsTier),
      q(JSON.stringify(r.aspects)),
      r.costUsd,
      q(r.label),
      r.enabled ? 1 : 0,
      now,
    ].join(",");
    return `INSERT INTO provider_routes(id,capability,mode,rank,parallel,provider,model,params,timeout_ms,pad_aspect,credits_tier,aspects,cost_usd,label,enabled,updated_at) VALUES(${values}) ON CONFLICT(id) DO UPDATE SET ${update};`;
  });
  rows.push(
    `DELETE FROM provider_routes WHERE id NOT IN (${seeds.map((r) => q(r.id)).join(",")});`,
  );
  return `${rows.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? "route-sync.sql";
  writeFileSync(out, routeSyncSql(seedRoutes()));
  console.log(`route-sync: wrote ${out}`);
}
