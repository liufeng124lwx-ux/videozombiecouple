import type { MeView } from "@vzc/contracts";
import { api } from "./api.ts";

let current: Promise<MeView | null> | null = null;

/** One GET /v1/me per page, shared by every island; null when the API cannot be reached. */
export function loadMe(): Promise<MeView | null> {
  current ??= api<MeView>("/v1/me").catch(() => null);
  return current;
}

export function refreshMe(): Promise<MeView | null> {
  current = null;
  return loadMe();
}
