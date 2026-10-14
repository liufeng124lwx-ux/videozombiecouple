import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installErrorCatcher } from "./errors.ts";

function fakeSdk() {
  const captured: unknown[] = [];
  const init = vi.fn();
  return { captured, init, sdk: { init, captureException: (e: unknown) => void captured.push(e) } };
}

// The test dispatches error events on purpose; this keeps jsdom from reporting them as uncaught.
const quiet = (event: Event) => event.preventDefault();
beforeEach(() => window.addEventListener("error", quiet));
afterEach(() => window.removeEventListener("error", quiet));

describe("error catcher (spec 8.4)", () => {
  it("loads the SDK on the first error only, then sends everything in order", async () => {
    const { captured, init, sdk } = fakeSdk();
    const load = vi.fn(async () => sdk);
    const remove = installErrorCatcher(load, "https://key@o0.ingest.sentry.io/2");
    const first = new Error("first");
    window.dispatchEvent(
      new ErrorEvent("error", { error: first, message: "first", cancelable: true }),
    );
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("second"), cancelable: true }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = "third";
    window.dispatchEvent(rejection);
    await vi.waitFor(() => expect(captured).toHaveLength(3));
    expect(load).toHaveBeenCalledTimes(1);
    expect(captured[0]).toBe(first);
    expect(captured[2]).toBe("third");
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o0.ingest.sentry.io/2",
        sendDefaultPii: false,
        defaultIntegrations: false,
      }),
    );
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("fourth"), cancelable: true }));
    expect(captured).toHaveLength(4);
    remove?.();
  });

  it("stays out of the way without a DSN", () => {
    const load = vi.fn();
    expect(installErrorCatcher(load, "")).toBeNull();
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("x"), cancelable: true }));
    expect(load).not.toHaveBeenCalled();
  });

  it("stops after 20 reports per page, so one error loop can't burn the quota", async () => {
    const { captured, sdk } = fakeSdk();
    const remove = installErrorCatcher(async () => sdk, "https://key@o0.ingest.sentry.io/2");
    for (let i = 0; i < 50; i++)
      window.dispatchEvent(
        new ErrorEvent("error", { error: new Error(`loop ${i}`), cancelable: true }),
      );
    await vi.waitFor(() => expect(captured.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(captured).toHaveLength(20);
    remove?.();
  });
});
