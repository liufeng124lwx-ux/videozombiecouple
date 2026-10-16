import type { CreatePhotoRequest, CreateStoryInput, SharedFilm, StoryView } from "@vzc/contracts";
import { ApiError, api, post } from "../api.ts";
import { withHumanCheck } from "../human-pass.ts";

export type UploadTicket = {
  key: string;
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSec: number;
};
export type QuotaView = {
  remaining: number;
  limit: number;
  resetAt: number | null;
  loginRequired?: boolean;
};
type Token = () => Promise<string>;

/** A signed storage address from the API, then the JPEG goes straight to storage. */
export async function uploadPhoto(jpeg: Blob, token: Token): Promise<string> {
  const ticket = await withHumanCheck(
    (headers) =>
      post<UploadTicket>("/v1/uploads", { contentType: "image/jpeg", bytes: jpeg.size }, headers),
    token,
  );
  let response: Response;
  try {
    response = await fetch(ticket.url, {
      method: ticket.method,
      headers: ticket.headers,
      body: jpeg,
    });
  } catch {
    throw new ApiError("NETWORK");
  }
  if (!response.ok) throw new ApiError("NETWORK");
  return ticket.key;
}

export async function createStory(request: CreateStoryInput, token: Token): Promise<string> {
  const { storyId } = await withHumanCheck(
    (headers) => post<{ storyId: string }>("/v1/stories", request, headers),
    token,
  );
  return storyId;
}

/** The free AI zombie filter: one photo in, a story id to poll with getStory. */
export async function createPhoto(request: CreatePhotoRequest, token: Token): Promise<string> {
  const { storyId } = await withHumanCheck(
    (headers) => post<{ storyId: string }>("/v1/photos", request, headers),
    token,
  );
  return storyId;
}

export function getStory(id: string): Promise<StoryView> {
  return api<StoryView>(`/v1/stories/${encodeURIComponent(id)}`);
}

/** A finished film behind its public share link (no sign-in). */
export function getSharedFilm(id: string, token: string): Promise<SharedFilm> {
  return api<SharedFilm>(`/v1/share/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`);
}

/**
 * Buying without signing in: a new email becomes this browser's (unverified) account. Throws
 * ApiError("LOGIN_REQUIRED") when the email already has an account (sign in with a code instead).
 */
export async function guestSignUp(email: string, token: Token): Promise<void> {
  await withHumanCheck(
    (headers) => post<{ ok: true }>("/v1/auth/guest", { email }, headers),
    token,
  );
}

/** One free remake of a finished film (the faces didn't come out right). */
export async function remake(id: string): Promise<void> {
  await post<{ ok: true }>(`/v1/stories/${encodeURIComponent(id)}/remake`, {});
}

export async function render(id: string, idempotencyKey: string, token: Token): Promise<void> {
  await withHumanCheck(
    (headers) =>
      post<{ ok: true }>(
        `/v1/stories/${encodeURIComponent(id)}/render`,
        { idempotencyKey },
        headers,
      ),
    token,
  );
}

export async function recompose(id: string, title: { names: string; date: string }): Promise<void> {
  await post<{ ok: true }>(`/v1/stories/${encodeURIComponent(id)}/recompose`, title);
}

/** @deprecated Free previews are gone (owner, 2026-10-15); kept for old imports. */
export function getQuota(): Promise<QuotaView> {
  return api<QuotaView>("/v1/quota");
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
