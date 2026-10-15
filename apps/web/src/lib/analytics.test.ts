import { beforeEach, describe, expect, it } from "vitest";
import {
  applyConsent,
  gaClientId,
  resetAnalytics,
  startAnalytics,
  track,
  userKind,
} from "./analytics.ts";

const IDS = { ga4: "G-TEST", clarity: "clar1" };
const CONTEXT = { lang: "en", page_id: "home", user_kind: "guest" as const };
const pushed = () => (window.dataLayer ?? []).map((args) => Array.from(args as ArrayLike<unknown>));
const scripts = () =>
  [...document.head.querySelectorAll("script")].map((s) => s.getAttribute("src"));

beforeEach(() => resetAnalytics());

describe("analytics (spec 7.5, 9)", () => {
  it("loads nothing before consent where consent is required, and sends no events", () => {
    startAnalytics(CONTEXT, "denied", IDS);
    track("tool_view");
    expect(scripts()).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
  });

  it("after Accept: GA4 loads in consent mode and events carry lang, page_id and user_kind; Clarity too", () => {
    startAnalytics(CONTEXT, "denied", IDS);
    applyConsent("granted", IDS, { explicit: true });
    track("download", { tier: "pro" });
    expect(pushed()[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    expect(pushed()).toContainEqual([
      "event",
      "download",
      { lang: "en", page_id: "home", user_kind: "guest", tier: "pro" },
    ]);
    expect(scripts()).toEqual([
      "https://www.googletagmanager.com/gtag/js?id=G-TEST",
      "https://www.clarity.ms/tag/clar1",
    ]);
  });

  it("where consent isn't required, GA4 runs by default but Clarity's session recording waits for a real yes", () => {
    startAnalytics(CONTEXT, "granted", IDS);
    expect(scripts()).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-TEST"]);
    applyConsent("granted", IDS, { explicit: true });
    expect(scripts()).toContain("https://www.clarity.ms/tag/clar1");
  });

  it("does nothing at all without IDs", () => {
    startAnalytics(CONTEXT, "granted", { ga4: "", clarity: "" });
    track("tool_view");
    expect(scripts()).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
  });

  it("tells guests, free members and paying members apart", () => {
    const user = { id: "u", email: "a@b.co", hasPassword: false, google: false, verified: true };
    const base = { owner: "o", credits: null, banner: null, consentRequired: false, paid: false };
    expect(userKind(null)).toBe("guest");
    expect(userKind({ ...base, user: null })).toBe("guest");
    expect(userKind({ ...base, user })).toBe("free");
    expect(userKind({ ...base, user, paid: true })).toBe("paid");
  });

  it("reads the GA4 client id for server-side purchase events", () => {
    expect(gaClientId()).toBeUndefined();
    document.cookie = "_ga=GA1.1.123456.789; path=/";
    expect(gaClientId()).toBe("123456.789");
  });
});
