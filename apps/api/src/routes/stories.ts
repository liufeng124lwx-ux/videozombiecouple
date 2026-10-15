import { MODES, RATE_LIMITS, RETENTION } from "@vzc/catalog";
import { CreateStorySchema, RecomposeSchema, RenderSchema, type SharedFilm } from "@vzc/contracts";
import type { Context } from "hono";
import { MAX_PAID_ATTEMPTS } from "../durable-objects/story-runner.ts";
import { fail } from "../http.ts";
import { readFlags } from "../middleware/flags.ts";
import { holdVideo, moveToKeep, paidBlock } from "../services/charge.ts";
import { hmacHex, safeEqual } from "../services/crypto.ts";
import { requireHuman } from "../services/human-pass.ts";
import { ulid } from "../services/ids.ts";
import { hitRate } from "../services/limits.ts";
import { settle } from "../services/settle.ts";
import { noteRejections } from "../services/suspicion.ts";
import { checkUpload } from "../services/upload-check.ts";
import type { StorySpec } from "../stories/types.ts";
import type { AppEnv, Bindings } from "../types.ts";

export const STORY_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function runnerFor(c: Context<AppEnv>, storyId: string) {
  return c.env.STORY_RUNNER.get(c.env.STORY_RUNNER.idFromName(storyId));
}

async function storyByKey(db: D1Database, owner: string, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM stories WHERE owner=? AND idempotency_key=?")
    .bind(owner, key)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** The story belongs to the signed-in account and has not expired (its files may be gone). */
async function ownedStory(c: Context<AppEnv>, id: string): Promise<boolean> {
  if (!STORY_ID.test(id)) return false;
  const row = await c.env.DB.prepare("SELECT owner, status, expires_at FROM stories WHERE id=?")
    .bind(id)
    .first<{ owner: string; status: string; expires_at: number }>();
  return (
    !!row && row.owner === c.get("owner") && row.status !== "expired" && row.expires_at > Date.now()
  );
}

/**
 * Limit, check the human and both photos, keep the photos, record the story and start its runner,
 * which only checks the photos (one adult face each) on our own container: nothing is generated
 * before payment (owner, 2026-10-15), so guests can start a story without an account.
 */
export async function createStory(c: Context<AppEnv>) {
  const userId = c.get("userId") ?? null;
  const parsed = CreateStorySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const request = parsed.data;
  if ((await readFlags(c.env.KV)).offline.includes("keyframe")) return fail(c, "PROVIDER_DOWN");
  const rate = await hitRate(
    c.env,
    `rate:stories:${userId ?? c.get("visitorHash")}`,
    RATE_LIMITS.userJobsPerMinute,
    60_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  const owner = c.get("owner");
  const existing = await storyByKey(c.env.DB, owner, request.idempotencyKey);
  if (existing) return c.json({ storyId: existing }, 200);
  if (request.survivorKey === request.infectedKey) return fail(c, "BAD_REQUEST");

  const visitorHash = c.get("visitorHash");
  for (const key of [request.survivorKey, request.infectedKey]) {
    const upload = await checkUpload(c.env, key, visitorHash);
    if (!upload.ok) return fail(c, upload.code);
  }
  await noteRejections(c.env, { owner, userId, fpHash: c.get("fpHash") });

  const id = ulid();
  const now = Date.now();
  const spec: StorySpec = {
    id,
    owner,
    userId,
    kind: request.kind,
    scene: request.scene,
    names: request.names || null,
    date: request.date || null,
    survivorKey: `keep/${id}/survivor.jpg`,
    infectedKey: `keep/${id}/infected.jpg`,
    createdAt: now,
  };
  try {
    await c.env.DB.prepare(
      "INSERT INTO stories(id,owner,user_id,visitor_hash,fp_hash,ip_hash,kind,scene,prompt_version,names,date,survivor_key,infected_key,status,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        owner,
        userId ?? "",
        visitorHash,
        c.get("fpHash"),
        c.get("ipSegmentHash"),
        spec.kind,
        spec.scene,
        MODES[spec.kind].promptVersion,
        spec.names,
        spec.date,
        spec.survivorKey,
        spec.infectedKey,
        "previewing",
        request.idempotencyKey,
        now,
        now + RETENTION.workDays * 86_400_000,
      )
      .run();
  } catch (error) {
    // Lost a race on the same idempotency key: hand back the winner's story.
    const winner = await storyByKey(c.env.DB, owner, request.idempotencyKey);
    if (winner) return c.json({ storyId: winner }, 200);
    throw error;
  }

  try {
    await moveToKeep(c.env, request.survivorKey, spec.survivorKey);
    await moveToKeep(c.env, request.infectedKey, spec.infectedKey);
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM stories WHERE id=?").bind(id).run();
    throw error;
  }
  try {
    await runnerFor(c, id).start(spec);
  } catch (error) {
    // The runner saved the story before failing and its alarm will resume it.
    console.error(JSON.stringify({ level: "error", storyId: id, start: String(error) }));
  }
  return c.json({ storyId: id }, 201);
}

/** Spec §4.1: the page polls every few seconds; only the owner may see the story. */
export async function getStory(c: Context<AppEnv>) {
  const rate = await hitRate(
    c.env,
    `rate:status:${c.get("visitorHash")}`,
    RATE_LIMITS.statusPerSecond,
    1_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  const id = c.req.param("id") ?? "";
  if (!(await ownedStory(c, id))) return fail(c, "NOT_FOUND");
  const view = await runnerFor(c, id).view();
  if (!view) return fail(c, "NOT_FOUND");
  const share = view.status === "done" && view.video ? await shareToken(c.env, id) : null;
  // When the film is deleted depends on the owner's account (3 or 30 days), which D1 knows.
  const row = await c.env.DB.prepare("SELECT expires_at FROM stories WHERE id=?")
    .bind(id)
    .first<{ expires_at: number }>();
  const video = view.video && row ? { ...view.video, expiresAt: row.expires_at } : view.video;
  return c.json({ ...view, video, shareToken: share });
}

/** The public link of a finished film: it names the story and cannot be guessed from the id. */
export async function shareToken(env: Bindings, storyId: string): Promise<string> {
  return (await hmacHex(`share:${storyId}`, env.HMAC_KEY)).slice(0, 32);
}

/** Spec: a finished film is shareable (the page is noindex). Only the film, never the photos. */
export async function getSharedFilm(c: Context<AppEnv>) {
  const rate = await hitRate(
    c.env,
    `rate:status:${c.get("visitorHash")}`,
    RATE_LIMITS.statusPerSecond,
    1_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  const id = c.req.param("id") ?? "";
  const token = c.req.query("t") ?? "";
  if (!STORY_ID.test(id) || !/^[0-9a-f]{32}$/.test(token)) return fail(c, "NOT_FOUND");
  if (!safeEqual(token, await shareToken(c.env, id))) return fail(c, "NOT_FOUND");
  const row = await c.env.DB.prepare("SELECT status, expires_at FROM stories WHERE id=?")
    .bind(id)
    .first<{ status: string; expires_at: number }>();
  if (!row || row.status === "expired" || row.expires_at <= Date.now()) return fail(c, "NOT_FOUND");
  const view = await runnerFor(c, id).view();
  if (!view || view.status !== "done" || !view.video) return fail(c, "NOT_FOUND");
  const film: SharedFilm = {
    scene: view.scene,
    names: view.names,
    date: view.date,
    video: view.video,
  };
  return c.json(film);
}

/** The account's recent stories, newest first (account page). */
export async function listStories(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "LOGIN_REQUIRED");
  const { results } = await c.env.DB.prepare(
    "SELECT id, status, kind, scene, created_at FROM stories WHERE owner=? AND status!='expired' ORDER BY created_at DESC LIMIT 30",
  )
    .bind(c.get("owner"))
    .all<{ id: string; status: string; kind: string; scene: string; created_at: number }>();
  return c.json({
    stories: results.map((r) => ({
      id: r.id,
      status: r.status,
      kind: r.kind,
      scene: r.scene,
      createdAt: r.created_at,
    })),
  });
}

/** Spec §4.1 step 3: hold the video credits and start the paid phase; repeats charge once. */
export async function renderStory(c: Context<AppEnv>) {
  const userId = c.get("userId");
  if (!userId) return fail(c, "LOGIN_REQUIRED");
  const parsed = RenderSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const id = c.req.param("id") ?? "";
  if (!(await ownedStory(c, id))) return fail(c, "NOT_FOUND");
  if ((await readFlags(c.env.KV)).offline.includes("shot")) return fail(c, "PROVIDER_DOWN");
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  // A repeat (double click, retry) with the run already started is a success without a new hold.
  const current = await runnerFor(c, id).view();
  if (!current) return fail(c, "NOT_FOUND");
  if (current.status === "rendering" || current.status === "done") return c.json({ ok: true }, 202);
  if (current.status !== "preview_ready" && current.status !== "failed")
    return fail(c, "NOT_READY");
  if (current.videoAttempts >= MAX_PAID_ATTEMPTS) return fail(c, "RETRY_NOT_ALLOWED");
  // Each paid attempt holds credits under its own reservation id (a released one must not be reused).
  const reservationId = current.videoAttempts === 0 ? id : `${id}:v${current.videoAttempts + 1}`;
  const hold = await holdVideo(c, id, reservationId);
  if (!hold.ok) return fail(c, hold.code);
  const outcome = await runnerFor(c, id).render(hold.charge);
  if (!outcome.ok) {
    // "already": a concurrent request won. If it holds the same reservation id, releasing would
    // undo the winner's hold — leave it; otherwise give this request's own hold back.
    const mine = hold.charge.kind === "credits" ? hold.charge.reservationId : null;
    if (outcome.reason !== "already" || outcome.activeReservation !== mine)
      await settle(c.env, id, hold.charge, null);
    if (outcome.reason === "not_ready") return fail(c, "NOT_READY");
    if (outcome.reason === "attempts") return fail(c, "RETRY_NOT_ALLOWED");
    return c.json({ ok: true }, 202);
  }
  // The film is kept 30 days for a verified account, 3 for a buyer who never verified (owner).
  await c.env.DB.prepare(
    "UPDATE stories SET render_key=?, rendered_at=?, retention=(SELECT CASE WHEN email_verified_at IS NULL THEN 'guest' ELSE 'member' END FROM users WHERE id=?) WHERE id=?",
  )
    .bind(parsed.data.idempotencyKey, Date.now(), c.get("userId"), id)
    .run();
  return c.json({ ok: true }, 202);
}

/** Owner, 2026-10-15: make a paid film again once for free while its photos still exist. */
export async function remakeStory(c: Context<AppEnv>) {
  const id = c.req.param("id") ?? "";
  if (!(await ownedStory(c, id))) return fail(c, "NOT_FOUND");
  // A remake is a whole new film on the models: the same gates as a paid render.
  const userId = c.get("userId");
  if (!userId) return fail(c, "LOGIN_REQUIRED");
  const blocked = await paidBlock(c, userId);
  if (blocked) return fail(c, blocked);
  const outcome = await runnerFor(c, id).remake();
  if (!outcome.ok)
    return fail(
      c,
      outcome.reason === "used"
        ? "REMAKE_USED"
        : outcome.reason === "photos_gone"
          ? "PHOTOS_EXPIRED"
          : "NOT_READY",
    );
  await c.env.DB.prepare("UPDATE stories SET rendered_at=? WHERE id=?").bind(Date.now(), id).run();
  return c.json({ ok: true }, 202);
}

/** Spec §7: one free change of the end title per video. */
export async function recomposeStory(c: Context<AppEnv>) {
  const parsed = RecomposeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const id = c.req.param("id") ?? "";
  if (!(await ownedStory(c, id))) return fail(c, "NOT_FOUND");
  const outcome = await runnerFor(c, id).recompose(parsed.data.names, parsed.data.date);
  if (!outcome.ok) return fail(c, outcome.reason === "used" ? "RECOMPOSE_USED" : "NOT_READY");
  // The stuck-story cron measures from rendered_at: a title change starts a new clock.
  await c.env.DB.prepare("UPDATE stories SET rendered_at=? WHERE id=?").bind(Date.now(), id).run();
  return c.json({ ok: true }, 202);
}
