import { KINDS, type Kind, SCENE_IDS, type SceneId } from "@vzc/catalog";
import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

/** Keys handed out by POST /v1/uploads (a ULID under in/). */
export const UploadKeySchema = z.string().regex(/^in\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);

const IdempotencyKey = z.string().min(8).max(64);
const Names = z.string().trim().max(40);
const DateText = z.string().trim().max(20);

/** Spec §4.1: who turns is chosen in the browser by swapping the two keys. */
export const CreateStorySchema = z.object({
  survivorKey: UploadKeySchema,
  infectedKey: UploadKeySchema,
  kind: z.enum(KINDS),
  scene: z.enum(SCENE_IDS),
  names: Names.optional(),
  date: DateText.optional(),
  idempotencyKey: IdempotencyKey,
});
export type CreateStoryRequest = z.infer<typeof CreateStorySchema>;

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
  scene: SceneId;
  names: string | null;
  date: string | null;
  preview: { A: string; C: string } | null;
  video: { url: string; poster: string; expiresAt: number } | null;
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
  scene: SceneId;
  names: string | null;
  date: string | null;
  video: { url: string; poster: string; expiresAt: number };
};
