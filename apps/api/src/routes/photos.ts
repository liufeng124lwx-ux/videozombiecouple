import { PHOTO } from "@vzc/catalog";
import { CreatePhotoSchema, UPLOAD_CONSENT_VERSION } from "@vzc/contracts";
import type { Context } from "hono";
import { fail } from "../http.ts";
import { readFlags } from "../middleware/flags.ts";
import { moveToKeep } from "../services/charge.ts";
import { requireHuman } from "../services/human-pass.ts";
import { ulid } from "../services/ids.ts";
import { hitRate } from "../services/limits.ts";
import { noteRejections } from "../services/suspicion.ts";
import { checkUpload } from "../services/upload-check.ts";
import type { StorySpec } from "../stories/types.ts";
import type { AppEnv } from "../types.ts";
import { runnerFor, storyByKey } from "./stories.ts";

const DAY_MS = 86_400_000;
/** Tries a day per browser, refused photos included: the check itself costs a little. */
const TRIES_PER_VISITOR_DAY = 5;

/** Photos made (or being made) today by this browser or this network; refused ones don't count. */
async function madeToday(c: Context<AppEnv>, column: "visitor_hash" | "ip_hash", value: string) {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM stories WHERE product='photo' AND ${column}=? AND created_at>? AND status NOT IN ('preview_failed','failed')`,
  )
    .bind(value, Date.now() - DAY_MS)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The free AI zombie filter (SEO review 2026-10-15): one photo of one person, turned into a zombie
 * portrait with the AI mark, free once a day per browser (PHOTO). The same consent, human check,
 * photo check and moderation as a film; the free budget pauses it. Read it back through
 * GET /v1/stories/:id like any story.
 */
export async function createPhoto(c: Context<AppEnv>) {
  const userId = c.get("userId") ?? null;
  const parsed = CreatePhotoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const request = parsed.data;
  if (request.consent !== UPLOAD_CONSENT_VERSION) return fail(c, "CONSENT_REQUIRED");
  const flags = await readFlags(c.env.KV);
  if (flags.freePaused) return fail(c, "FREE_TIER_PAUSED");
  if (flags.offline.includes("keyframe")) return fail(c, "PROVIDER_DOWN");
  const visitorHash = c.get("visitorHash");
  const ipHash = c.get("ipSegmentHash");
  const owner = c.get("owner");
  const existing = await storyByKey(c.env.DB, owner, request.idempotencyKey);
  if (existing) return c.json({ storyId: existing }, 200);
  const tries = await hitRate(c.env, `rate:photo:v:${visitorHash}`, TRIES_PER_VISITOR_DAY, DAY_MS);
  if (!tries.allowed) return fail(c, "DAILY_LIMIT", tries.retryAfterSec);
  if (
    (await madeToday(c, "visitor_hash", visitorHash)) >= PHOTO.freePerVisitorDay ||
    (await madeToday(c, "ip_hash", ipHash)) >= PHOTO.freePerIpDay
  )
    return fail(c, "DAILY_LIMIT");
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  const upload = await checkUpload(c.env, request.photoKey, visitorHash);
  if (!upload.ok) return fail(c, upload.code);
  await noteRejections(c.env, { owner, userId, fpHash: c.get("fpHash") });

  const id = ulid();
  const now = Date.now();
  const keep = `keep/${id}/survivor.jpg`;
  const spec: StorySpec = {
    id,
    owner,
    userId,
    kind: "human",
    scene: "cabin-wheat",
    names: null,
    date: null,
    survivorKey: keep,
    infectedKey: keep,
    createdAt: now,
    product: "photo",
  };
  try {
    await c.env.DB.prepare(
      "INSERT INTO stories(id,owner,user_id,visitor_hash,fp_hash,ip_hash,kind,scene,prompt_version,survivor_key,infected_key,status,idempotency_key,created_at,expires_at,consent_version,consent_at,product) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'photo')",
    )
      .bind(
        id,
        owner,
        userId ?? "",
        visitorHash,
        c.get("fpHash"),
        ipHash,
        spec.kind,
        spec.scene,
        PHOTO.promptVersion,
        keep,
        keep,
        "previewing",
        request.idempotencyKey,
        now,
        now + PHOTO.keepHours * 3_600_000,
        request.consent,
        now,
      )
      .run();
  } catch (error) {
    const winner = await storyByKey(c.env.DB, owner, request.idempotencyKey);
    if (winner) return c.json({ storyId: winner }, 200);
    throw error;
  }
  try {
    await moveToKeep(c.env, request.photoKey, keep);
  } catch (error) {
    await c.env.DB.prepare("DELETE FROM stories WHERE id=?").bind(id).run();
    throw error;
  }
  try {
    await runnerFor(c, id).start(spec);
  } catch (error) {
    console.error(JSON.stringify({ level: "error", storyId: id, start: String(error) }));
  }
  return c.json({ storyId: id }, 201);
}
