import { cleanup } from "@testing-library/preact";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (typeof document === "undefined") return;
  localStorage.clear();
  sessionStorage.clear();
  for (const cookie of document.cookie.split("; ")) {
    const name = cookie.split("=")[0];
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
});
