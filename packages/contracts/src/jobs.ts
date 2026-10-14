import { CAPABILITY_IDS, type CapabilityId, MODE_IDS, type ModeId } from "@vzc/catalog";
import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

const unit = z.number().min(0).max(1);
const EPSILON = 1e-6;

export const CropBoxSchema = z
  .object({ x: unit, y: unit, w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) })
  .refine((b) => b.x + b.w <= 1 + EPSILON && b.y + b.h <= 1 + EPSILON, {
    message: "crop box must lie inside the canvas",
  });

export const FaceBoxSchema = z.object({ x: unit, y: unit, w: unit, h: unit });

/** Browser diagnosis sent with each job (spec 3.4), stored in jobs.diagnosis. */
export const DiagnosisSchema = z.object({
  sharpness: z.number().int().min(0).max(100),
  blur: z.enum(["motion", "focus", "lowres", "none"]),
  angleDeg: z.number().min(0).max(180).nullable(),
  faces: z.array(FaceBoxSchema).max(20),
  textDensity: unit,
  oldPhoto: z.boolean(),
});

export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/** R2 key issued by the presign endpoint: in/<ULID>.jpg. */
export const UPLOAD_KEY_PATTERN = /^in\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/;

export const CreateJobSchema = z.object({
  uploadKey: z.string().regex(UPLOAD_KEY_PATTERN),
  capability: z.enum(CAPABILITY_IDS),
  mode: z.enum(MODE_IDS),
  modeSource: z.enum(["auto", "user"]),
  cropBox: CropBoxSchema,
  diagnosis: DiagnosisSchema,
  idempotencyKey: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});
export type CreateJobRequest = z.infer<typeof CreateJobSchema>;

/** Fidelity check numbers the browser computed (spec 3.7). */
export const GuardMetricsSchema = z.object({
  composition: z.number().min(-1).max(1),
  colorDeltaE: z.number().min(0).max(200),
  faces: z
    .object({ expected: z.number().int().min(0), matched: z.number().int().min(0) })
    .nullable(),
  passed: z.boolean(),
});
export type GuardMetrics = z.infer<typeof GuardMetricsSchema>;

export const RetrySchema = z
  .object({
    attemptId: z.string().min(1).max(64),
    reason: z.enum(["guard", "thumbs_down"]),
    guard: GuardMetricsSchema.optional(),
    feedback: z.enum(["face", "text", "not_sharp", "colors"]).optional(),
  })
  .refine((r) => r.reason !== "guard" || (r.guard !== undefined && !r.guard.passed), {
    message: "a guard retry needs failing guard metrics",
  });
export type RetryRequest = z.infer<typeof RetrySchema>;

export type JobState = "created" | "queued" | "submitted" | "succeeded" | "failed" | "expired";
export type AttemptState = "pending" | "succeeded" | "failed" | "abandoned";

/** One model run inside a job, as GET /jobs/:id returns it. */
export type AttemptView = {
  id: string;
  label: string;
  state: AttemptState;
  resultUrl: string | null;
  freeRetry: boolean;
};

export type ChargeView = { kind: "quota" | "credits" | "free_retry" | "none"; credits: number };

export type JobView = {
  id: string;
  capability: CapabilityId;
  mode: ModeId;
  state: JobState;
  queuePosition: number | null;
  etaMs: number | null;
  inputUrl: string | null;
  attempts: AttemptView[];
  charge: ChargeView;
  errorCode: ErrorCode | null;
  expiresAt: number;
};

/** GET /v1/tools: the ratios the browser pads to, per capability (spec 3.1). */
export type ToolsView = Record<CapabilityId, { pad: boolean; aspects: string[] }>;
