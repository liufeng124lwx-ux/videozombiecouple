/** An API failure: `code` is the API's error code, or NETWORK when the API could not be reached. */
export class ApiError extends Error {
  readonly code: string;
  readonly retryAfterSec: number | undefined;
  constructor(code: string, retryAfterSec?: number) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function apiOrigin(): string {
  return (import.meta.env.PUBLIC_API_ORIGIN || "http://localhost:8787").replace(/\/+$/, "");
}

export type RequestOptions = {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** Calls apps/api with the session cookie (spec 1.1: api.videozombiecouple.com, cookies on .videozombiecouple.com). */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const hasBody = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, {
      method: hasBody ? "POST" : "GET",
      credentials: "include",
      headers: { ...(hasBody ? { "content-type": "application/json" } : {}), ...options.headers },
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError("NETWORK");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (data as { error?: { code?: unknown; retryAfterSec?: unknown } } | null)?.error;
    const code =
      typeof error?.code === "string"
        ? error.code
        : response.status >= 500
          ? "INTERNAL"
          : "BAD_REQUEST";
    throw new ApiError(
      code,
      typeof error?.retryAfterSec === "number" ? error.retryAfterSec : undefined,
    );
  }
  return data as T;
}

export function post<T>(
  path: string,
  body: unknown = {},
  headers: Record<string, string> = {},
): Promise<T> {
  return api<T>(path, { body, headers });
}
