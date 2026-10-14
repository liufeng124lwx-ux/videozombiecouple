import type { CapabilityId, ModeId } from "@vzc/catalog";
import { type Route, seedRoutes } from "@vzc/providers";

type Row = {
  id: string;
  capability: string;
  mode: string | null;
  rank: number;
  parallel: number;
  provider: string;
  model: string;
  params: string;
  timeout_ms: number;
  aspects: string;
  cost_usd: number;
  label: string;
  enabled: number;
  durations: string;
};

const CACHE_MS = 30_000;
const cache = new WeakMap<D1Database, { at: number; routes: Route[] }>();

function fromRow(row: Row): Route {
  return {
    id: row.id,
    capability: row.capability as CapabilityId,
    mode: row.mode as ModeId | null,
    rank: row.rank,
    parallel: row.parallel === 1,
    provider: "kie",
    model: row.model,
    params: JSON.parse(row.params) as Record<string, string>,
    timeoutMs: row.timeout_ms,
    aspects: JSON.parse(row.aspects) as string[],
    costUsd: row.cost_usd,
    label: row.label,
    ...(JSON.parse(row.durations || "{}") as Pick<Route, "minSec" | "maxSec" | "allowedSec">),
    enabled: row.enabled === 1,
  };
}

/** Spec 4.5: admin edits in D1 win; an empty table means the catalog seeds. Cached 30 seconds. */
export async function loadRoutes(db: D1Database): Promise<Route[]> {
  const cached = cache.get(db);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.routes;
  const { results } = await db.prepare("SELECT * FROM provider_routes ORDER BY id").all<Row>();
  const routes = results.length === 0 ? seedRoutes() : results.map(fromRow);
  cache.set(db, { at: Date.now(), routes });
  return routes;
}

export function forgetRoutes(db: D1Database): void {
  cache.delete(db);
}

/** The clip limits of a video route as stored in provider_routes.durations. */
export function durationsJson(r: Route): string {
  const { minSec, maxSec, allowedSec } = r;
  return JSON.stringify({ minSec, maxSec, allowedSec });
}

/** Spec 8.1 / 4.5: the first edit writes the seeds into D1, then changes the one route. */
export async function saveRoute(
  db: D1Database,
  id: string,
  patch: { enabled: boolean; rank: number; timeoutMs: number },
): Promise<void> {
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM provider_routes")
    .first<{ n: number }>();
  if ((count?.n ?? 0) === 0) {
    const now = Date.now();
    await db.batch(
      seedRoutes().map((r) =>
        db
          .prepare(
            "INSERT OR IGNORE INTO provider_routes(id,capability,mode,rank,parallel,provider,model,params,timeout_ms,pad_aspect,credits_tier,aspects,cost_usd,label,enabled,updated_at,durations) VALUES(?,?,?,?,?,?,?,?,?,0,'video',?,?,?,?,?,?)",
          )
          .bind(
            r.id,
            r.capability,
            r.mode,
            r.rank,
            r.parallel ? 1 : 0,
            r.provider,
            r.model,
            JSON.stringify(r.params),
            r.timeoutMs,
            JSON.stringify(r.aspects),
            r.costUsd,
            r.label,
            r.enabled ? 1 : 0,
            now,
            durationsJson(r),
          ),
      ),
    );
  }
  await db
    .prepare("UPDATE provider_routes SET enabled=?, rank=?, timeout_ms=?, updated_at=? WHERE id=?")
    .bind(patch.enabled ? 1 : 0, patch.rank, patch.timeoutMs, Date.now(), id)
    .run();
  forgetRoutes(db);
}
