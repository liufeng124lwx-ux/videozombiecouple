import { KINDS, type Kind, STORY_IDS, type StoryId } from "@vzc/catalog";
import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

/** Keys handed out by POST /v1/uploads (a ULID under in/). */
export const UploadKeySchema = z.string().regex(/^in\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);

const IdempotencyKey = z.string().min(8).max(64);
const Names = z.string().trim().max(40);
const DateText = z.string().trim().max(20);

/** Spec §4.1: who turns is chosen in the browser by swapping the two keys. */
/**
 * The upload consent the person ticks before every story (both people are adults who agreed; the
 * in-memory face analysis). Bump it whenever that text changes: stories record the version agreed to.
 */
export const UPLOAD_CONSENT_VERSION = "2026-10-15";

export const CreateStorySchema = z.object({
  survivorKey: UploadKeySchema,
  infectedKey: UploadKeySchema,
  kind: z.enum(KINDS),
  /** Christmas spec §4.2: absent = the zombie story. Scene and kind are checked against it. */
  story: z.enum(STORY_IDS).default("zombie"),
  scene: z.string().min(1).max(40),
  names: Names.optional(),
  date: DateText.optional(),
  idempotencyKey: IdempotencyKey,
  /** UPLOAD_CONSENT_VERSION; anything else is answered CONSENT_REQUIRED. */
  consent: z.string().max(32).optional(),
});
export type CreateStoryRequest = z.infer<typeof CreateStorySchema>;
/** What a client sends: the story may be left out (a zombie film). */
export type CreateStoryInput = z.input<typeof CreateStorySchema>;

/** POST /v1/photos: the free AI zombie filter, one photo of one person. */
export const CreatePhotoSchema = z.object({
  photoKey: UploadKeySchema,
  idempotencyKey: IdempotencyKey,
  /** UPLOAD_CONSENT_VERSION; anything else is answered CONSENT_REQUIRED. */
  consent: z.string().max(32).optional(),
});
export type CreatePhotoRequest = z.infer<typeof CreatePhotoSchema>;

export const RenderSchema = z.object({ idempotencyKey: IdempotencyKey });

/** Spec §7: one free change of the end title per paid video. */
export const RecomposeSchema = z.object({ names: Names, date: DateText });

export type StoryStatus =
  | "previewing"
  | "preview_ready"
  | "preview_failed"
  | "rendering"
  | "done"
  | "failed";

/** What GET /v1/stories/:id returns; URLs are signed and short-lived. */
export type StageView = {
  id: string;
  state: "waiting" | "running" | "done";
};

export type StoryView = {
  id: string;
  status: StoryStatus;
  kind: Kind;
  story: StoryId;
  scene: string;
  names: string | null;
  date: string | null;
  preview: { A: string; C: string } | null;
  video: { url: string; poster: string; expiresAt: number } | null;
  /** The free AI zombie filter: the watermarked photo once it is done (absent on films). */
  photo?: string | null;
  progress: { done: number; total: number; etaMs: number | null };
  /** While the film renders: keyframes ("frames"), each shot, then the final cut. Else empty. */
  stages?: StageView[];
  /** While the film renders: signed links to the chosen keyframes so far (A, C, then B). */
  frames?: string[];
  errorCode: ErrorCode | null;
  recomposeLeft: number;
  /** Free remakes of the whole film left (the faces didn't come out right). */
  remakeLeft: number;
  /** Paid render attempts started (a failed video can be rendered again with a new hold). */
  videoAttempts: number;
  /** Owner only, once the film is done: the token of its public link (/story?id=…&t=…). */
  shareToken?: string | null;
  createdAt: number;
};

/** GET /v1/share/:id?t=… — what anyone holding the share link sees. */
export type SharedFilm = {
  scene: string;
  names: string | null;
  date: string | null;
  /** Which story the film tells; the share page words itself by it. */
  story: StoryId;
  video: { url: string; poster: string; expiresAt: number };
};
