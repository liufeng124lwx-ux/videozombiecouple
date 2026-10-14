import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { hashIdentity } from "../services/crypto.ts";
import type { AppEnv } from "../types.ts";

export function ipSegment(ip: string): string {
  const ipv4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4 && ipv4.slice(1).every((piece) => Number(piece) <= 255)) {
    return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  }
  if (!ip.includes(":")) return "unknown";
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return "unknown";
  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  if (left.concat(right).some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return "unknown";
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
    return "unknown";
  const words = [...left, ...Array(missing).fill("0"), ...right];
  return `${words
    .slice(0, 4)
    .map((word) => Number.parseInt(word, 16).toString(16))
    .join(":")}::/64`;
}

/** Hash of UA, screen, timezone and language, computed by the browser (spec 5.1). */
const DEVICE = /^[A-Za-z0-9_-]{8,128}$/;

/** Spec 5.1: a guest is a cookie, an IP segment and a device fingerprint, each counted apart. */
export const identity = () =>
  createMiddleware<AppEnv>(async (c, next) => {
    const existing = getCookie(c, "vid");
    const visitorId =
      existing && /^[a-f0-9]{32}$/.test(existing)
        ? existing
        : crypto.randomUUID().replace(/-/g, "");
    if (visitorId !== existing)
      setCookie(c, "vid", visitorId, {
        domain: c.env.COOKIE_DOMAIN || undefined,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: 31_536_000,
        path: "/",
      });
    const device = c.req.header("x-device");
    const segment = ipSegment(c.req.header("CF-Connecting-IP") ?? "");
    const visitorHash = await hashIdentity(`visitor:${visitorId}`, c.env.HMAC_KEY);
    c.set("visitorId", visitorId);
    c.set("visitorHash", visitorHash);
    c.set(
      "fpHash",
      device && DEVICE.test(device) ? await hashIdentity(`device:${device}`, c.env.HMAC_KEY) : null,
    );
    c.set("ipSegment", segment);
    c.set("ipSegmentHash", await hashIdentity(`ip:${segment}`, c.env.HMAC_KEY));
    c.set("owner", `g:${visitorHash}`);
    c.set("guestOwner", `g:${visitorHash}`);
    c.set("userId", null);
    await next();
  });
