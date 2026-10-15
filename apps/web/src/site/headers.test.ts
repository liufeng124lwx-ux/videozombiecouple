import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const headers = (() => {
  try {
    return readFileSync(join(import.meta.dirname, "../../public/_headers"), "utf8");
  } catch {
    return "";
  }
})();

describe("site security headers (public/_headers)", () => {
  it("every page forbids framing and sniffing, asks for HTTPS and keeps referrers short", () => {
    expect(headers).toMatch(/^\/\*$/m);
    for (const line of [
      "Strict-Transport-Security: max-age=31536000; includeSubDomains",
      "X-Content-Type-Options: nosniff",
      "X-Frame-Options: DENY",
      "Referrer-Policy: strict-origin-when-cross-origin",
      "Permissions-Policy: camera=(), microphone=(), geolocation=()",
    ])
      expect(headers).toContain(`  ${line}`);
    expect(headers).toMatch(
      /Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'/,
    );
  });
});
