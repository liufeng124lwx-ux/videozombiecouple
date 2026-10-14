import type { RouteSeed } from "@vzc/catalog";

/** A provider_routes row at runtime: the seed plus the admin on/off switch. */
export type Route = RouteSeed & { enabled: boolean };

export type JobInput = {
  /** Signed R2 URL of the padded JPG (spec 3.2). */
  imageUrl: string;
  prompt: string;
  /** One of route.aspects; the browser padded the photo to it. */
  aspect: string;
  /** P1 mask editing. */
  maskUrl?: string;
};

export type StatusResult =
  | { state: "pending" }
  | { state: "success"; outputUrls: string[]; costUsd: number | null; costTimeMs: number | null }
  | { state: "fail"; costUsd: number | null; failCode?: string; failMsg?: string };

/** Spec 4.3. */
export type FailKind =
  | "rate_limited"
  | "invalid"
  | "content_rejected"
  | "timeout"
  | "provider_error"
  | "key_daily_cap";

export interface ProviderAdapter {
  submit(route: RouteSeed, input: JobInput, callbackUrl: string): Promise<{ taskId: string }>;
  status(taskId: string): Promise<StatusResult>;
  classify(fail: { code?: number | string; msg?: string }): FailKind;
}

export class ProviderError extends Error {
  readonly kind: FailKind;
  readonly code: number | string | undefined;

  constructor(kind: FailKind, message: string, code?: number | string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.code = code;
  }
}
