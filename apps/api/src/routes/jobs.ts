import { CAPABILITIES, type CapabilityId, MODES, RATE_LIMITS, RETENTION } from "@vzc/catalog";
import { CreateJobSchema, nearestAspect, parseAspect, RetrySchema } from "@vzc/contracts";
import { padAspects } from "@vzc/providers";
import type { Context } from "hono";
import { fail } from "../http.ts";
import type { JobSpec } from "../jobs/types.ts";
import { toJobView } from "../jobs/view.ts";
import { readFlags } from "../middleware/flags.ts";
import { holdCharge, moveToKeep } from "../services/charge.ts";
import { retryAllowed } from "../services/free-retry.ts";
import { requireHuman } from "../services/human-pass.ts";
import { ulid } from "../services/ids.ts";
import { hitRate } from "../services/limits.ts";
import { loadRoutes } from "../services/routes-store.ts";
import { settle } from "../services/settle.ts";
import { noteRejections } from "../services/suspicion.ts";
import { checkUpload } from "../services/upload-check.ts";
import type { AppEnv } from "../types.ts";

export const JOB_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** The browser pads to an exact ratio; allow a pixel or two of rounding. */
const ASPECT_TOLERANCE = 0.01;

export function runnerFor(c: Context<AppEnv>, jobId: string) {
  return c.env.JOB_RUNNER.get(c.env.JOB_RUNNER.idFromName(jobId));
}

/** The job belongs to this account, or to this browser's guest identity (spec 5.1). */
export function ownsJob(c: Context<AppEnv>, owner: string): boolean {
  return owner === c.get("owner") || owner === c.get("guestOwner");
}

async function jobByKey(db: D1Database, owner: string, key: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM jobs WHERE owner=? AND idempotency_key=?")
    .bind(owner, key)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** Spec 4.1 / 7.1: limit, check the human, the file and the charge, record the job, start it. */
export async function createJob(c: Context<AppEnv>) {
  const parsed = CreateJobSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const request = parsed.data;
  // Spec 8.1: a capability the admin took offline takes no new jobs; running ones finish.
  if ((await readFlags(c.env.KV)).offline.includes(request.capability))
    return fail(c, "PROVIDER_DOWN");
  const visitorHash = c.get("visitorHash");
  const userId = c.get("userId");
  const rate = await hitRate(
    c.env,
    `rate:jobs:${userId ?? visitorHash}`,
    userId ? RATE_LIMITS.userJobsPerMinute : RATE_LIMITS.guestJobsPerMinute,
    60_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  const owner = c.get("owner");
  const existing = await jobByKey(c.env.DB, owner, request.idempotencyKey);
  if (existing) return c.json({ jobId: existing }, 200);

  const capability = CAPABILITIES[request.capability];
  const upload = await checkUpload(c.env, request.uploadKey, visitorHash);
  if (!upload.ok) return fail(c, upload.code);
  const { pad, aspects } = padAspects(await loadRoutes(c.env.DB), request.capability);
  const aspect = nearestAspect(upload.width, upload.height, aspects);
  const off = Math.abs(Math.log(upload.width / upload.height / parseAspect(aspect)));
  if (pad && off > ASPECT_TOLERANCE) return fail(c, "FILE_UNSUPPORTED");
  // Spec 7.3: mark accounts and devices with too many rejected photos before deciding the charge.
  await noteRejections(c.env, { owner, userId, fpHash: c.get("fpHash") });

  const jobId = ulid();
  const now = Date.now();
  const mode = MODES[request.mode];
  try {
    await c.env.DB.prepare(
      "INSERT INTO jobs(id,owner,visitor_hash,fp_hash,ip_hash,capability,mode,mode_source,tier,prompt_version,input_key,crop_box,diagnosis,status,charge,priority,idempotency_key,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        jobId,
        owner,
        visitorHash,
        c.get("fpHash"),
        c.get("ipSegmentHash"),
        request.capability,
        request.mode,
        request.modeSource,
        capability.tier,
        mode.promptVersion,
        request.uploadKey,
        JSON.stringify(request.cropBox),
        JSON.stringify(request.diagnosis),
        "created",
        JSON.stringify({ kind: "pending" }),
        "free",
        request.idempotencyKey,
        now,
        now + RETENTION.freeHours * 3_600_000,
      )
      .run();
  } catch (error) {
    // Lost a race on the same idempotency key: the unique index picked the winner before either
    // request touched the quota or the wallet, so hand back the winner's job.
    const winner = await jobByKey(c.env.DB, owner, request.idempotencyKey);
    if (winner) return c.json({ jobId: winner }, 200);
    throw error;
  }

  const hold = await holdCharge(c, capability, jobId);
  if (!hold.ok) {
    await c.env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(jobId).run();
    return fail(c, hold.code);
  }
  let inputKey = request.uploadKey;
  let expiresAt = now + RETENTION.freeHours * 3_600_000;
  try {
    if (hold.charge.kind === "credits") {
      inputKey = await moveToKeep(c.env, request.uploadKey);
      expiresAt = now + RETENTION.creditDays * 86_400_000;
    }
    await c.env.DB.prepare(
      "UPDATE jobs SET input_key=?, charge=?, priority=?, expires_at=? WHERE id=?",
    )
      .bind(inputKey, JSON.stringify({ kind: hold.charge.kind }), hold.priority, expiresAt, jobId)
      .run();
  } catch (error) {
    await settle(c.env, jobId, hold.charge, null);
    await c.env.DB.prepare("DELETE FROM jobs WHERE id=?").bind(jobId).run();
    throw error;
  }

  const spec: JobSpec = {
    id: jobId,
    owner,
    capability: request.capability,
    mode: request.mode,
    prompt: mode.prompt,
    promptVersion: mode.promptVersion,
    aspect,
    inputKey,
    priority: hold.priority,
    charge: hold.charge,
    createdAt: now,
    expiresAt,
  };
  try {
    await runnerFor(c, jobId).start(spec);
  } catch (error) {
    // The runner saved the job before failing and its alarm will resume it.
    console.error(JSON.stringify({ level: "error", jobId, start: String(error) }));
  }
  return c.json({ jobId }, 201);
}

/** Spec 4.1: the page polls every 2 seconds; only the owner may see the job. */
export async function getJob(c: Context<AppEnv>) {
  const rate = await hitRate(
    c.env,
    `rate:status:${c.get("visitorHash")}`,
    RATE_LIMITS.statusPerSecond,
    1_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  const id = c.req.param("id") ?? "";
  if (!JOB_ID.test(id)) return fail(c, "NOT_FOUND");
  const row = await c.env.DB.prepare("SELECT owner FROM jobs WHERE id=?")
    .bind(id)
    .first<{ owner: string }>();
  if (!row || !ownsJob(c, row.owner)) return fail(c, "NOT_FOUND");
  const view = await runnerFor(c, id).view();
  if (!view) return fail(c, "NOT_FOUND");
  return c.json(await toJobView(c.env, view));
}

/**
 * Spec 3.7: one free retry per job, sharing the job request limit and the human pass (spec 7.1).
 * Checks ownership and the per-identity limits here; the runner checks the job's own state.
 */
export async function retryJob(c: Context<AppEnv>) {
  const parsed = RetrySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  const visitorHash = c.get("visitorHash");
  const rate = await hitRate(
    c.env,
    `rate:jobs:${visitorHash}`,
    RATE_LIMITS.guestJobsPerMinute,
    60_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  const id = c.req.param("id") ?? "";
  const owner = c.get("owner");
  const row = JOB_ID.test(id)
    ? await c.env.DB.prepare("SELECT owner, free_retry, capability FROM jobs WHERE id=?")
        .bind(id)
        .first<{ owner: string; free_retry: number; capability: CapabilityId }>()
    : null;
  if (!row || !ownsJob(c, row.owner)) return fail(c, "NOT_FOUND");
  // A free retry is a new provider call too: none on a capability the admin took offline.
  if ((await readFlags(c.env.KV)).offline.includes(row.capability)) return fail(c, "PROVIDER_DOWN");
  if (row.free_retry === 1) return fail(c, "RETRY_NOT_ALLOWED");
  if (
    !(await retryAllowed(c.env.DB, {
      owner,
      userId: c.get("userId"),
      visitorHash,
      fpHash: c.get("fpHash"),
    }))
  )
    return fail(c, "RETRY_NOT_ALLOWED");
  const outcome = await runnerFor(c, id).retry(parsed.data);
  if (!outcome.ok)
    return fail(c, outcome.reason === "not_found" ? "NOT_FOUND" : "RETRY_NOT_ALLOWED");
  await c.env.DB.prepare("UPDATE jobs SET free_retry=1, retried_at=?, feedback=? WHERE id=?")
    .bind(Date.now(), parsed.data.feedback ?? null, id)
    .run();
  return c.json({ ok: true }, 202);
}
