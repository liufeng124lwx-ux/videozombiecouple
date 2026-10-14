import { createMiddleware } from "hono/factory";
import { fail } from "../http.ts";
import type { AppEnv } from "../types.ts";

const cache = new WeakMap<D1Database, Map<string, { at: number; banned: boolean }>>();

async function banned(db: D1Database, hash: string): Promise<boolean> {
  let entries = cache.get(db);
  if (!entries) {
    entries = new Map();
    cache.set(db, entries);
  }
  const prior = entries.get(hash);
  if (prior && Date.now() - prior.at < 60_000) return prior.banned;
  const found = await db
    .prepare("SELECT id FROM bans WHERE hash=? AND expires>? LIMIT 1")
    .bind(hash, Date.now())
    .first();
  entries.set(hash, { at: Date.now(), banned: found !== null });
  return found !== null;
}

/** Spec 7.1 step 3: banned visitors, devices and IP segments get 403. */
export const ban = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    // Account bans store the user id as the hash (spec 7.1).
    const hashes = [c.get("visitorHash"), c.get("ipSegmentHash"), c.get("fpHash"), c.get("userId")];
    for (const hash of hashes) {
      if (hash !== null && (await banned(c.env.DB, hash))) return fail(c, "FORBIDDEN");
    }
    await next();
  });
