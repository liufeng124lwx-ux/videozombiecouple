import { FILE_LIMITS, RATE_LIMITS } from "@vzc/catalog";
import type { Context } from "hono";
import { z } from "zod";
import { fail } from "../http.ts";
import { requireHuman } from "../services/human-pass.ts";
import { ulid } from "../services/ids.ts";
import { hitRate } from "../services/limits.ts";
import { presign } from "../services/r2-presign.ts";
import type { AppEnv } from "../types.ts";

const UploadSchema = z.object({
  contentType: z.literal("image/jpeg"),
  bytes: z.number().int().positive(),
});

const PUT_URL_SEC = 600;
const UPLOAD_OWNER_TTL_SEC = 86_400;

/** Spec 3.2 step 1: the browser uploads straight to R2; the Worker never sees the bytes. */
export async function createUpload(c: Context<AppEnv>) {
  const parsed = UploadSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "BAD_REQUEST");
  if (parsed.data.bytes > FILE_LIMITS.maxBytes) return fail(c, "FILE_TOO_LARGE");
  const rate = await hitRate(
    c.env,
    `rate:uploads:${c.get("visitorHash")}`,
    RATE_LIMITS.userJobsPerMinute,
    60_000,
  );
  if (!rate.allowed) return fail(c, "RATE_LIMITED", rate.retryAfterSec);
  if (!(await requireHuman(c))) return fail(c, "CHALLENGE_REQUIRED");
  const key = `in/${ulid()}.jpg`;
  await c.env.KV.put(`upload:${key}`, c.get("visitorHash"), {
    expirationTtl: UPLOAD_OWNER_TTL_SEC,
  });
  return c.json(
    {
      key,
      // R2 rejects a PUT whose size or type differs from what the browser declared here.
      url: await presign(c.env, key, "PUT", PUT_URL_SEC, {
        "content-length": String(parsed.data.bytes),
        "content-type": "image/jpeg",
      }),
      method: "PUT",
      headers: { "content-type": "image/jpeg" },
      expiresInSec: PUT_URL_SEC,
    },
    201,
  );
}
