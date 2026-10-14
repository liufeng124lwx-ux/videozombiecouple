import { vi } from "vitest";

export type Answer = { status?: number; body?: unknown };
type Route = Answer | Answer[] | ((body: unknown) => Answer);
export type Call = { method: string; path: string; body: unknown; headers: Record<string, string> };

/**
 * Stubs fetch with answers keyed "METHOD /path". An array answers in turn and repeats its last
 * entry; a function sees the parsed request body. Unknown routes answer 404 NOT_FOUND.
 */
export function mockApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({
      method,
      path: url.pathname + url.search,
      body,
      headers: { ...(init.headers as Record<string, string>) },
    });
    const route = routes[`${method} ${url.pathname}`];
    let answer: Answer = { status: 404, body: { error: { code: "NOT_FOUND" } } };
    if (Array.isArray(route)) answer = (route.length > 1 ? route.shift() : route[0]) ?? answer;
    else if (typeof route === "function") answer = route(body);
    else if (route) answer = route;
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export const apiError = (code: string, status = 400, retryAfterSec?: number): Answer => ({
  status,
  body: {
    error: { code, requestId: "r", ...(retryAfterSec === undefined ? {} : { retryAfterSec }) },
  },
});
