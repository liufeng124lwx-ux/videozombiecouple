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
  it("loads GA4 in consent mode with storage denied, and sends no events", () => {
    startAnalytics(CONTEXT, "denied", IDS);
    expect(pushed()[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    track("tool_view");
    expect(pushed().some((args) => args[0] === "event")).toBe(false);
    expect(scripts()).toEqual(["https://www.googletagmanager.com/gtag/js?id=G-TEST"]);
  });

  it("sends events with lang, page_id and user_kind after consent, and only then loads Clarity", () => {
    startAnalytics(CONTEXT, "denied", IDS);
    applyConsent("granted", IDS);
    track("download", { tier: "pro" });
    expect(pushed()).toContainEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(pushed()).toContainEqual([
      "event",
      "download",
      { lang: "en", page_id: "home", user_kind: "guest", tier: "pro" },
    ]);
    expect(scripts()).toContain("https://www.clarity.ms/tag/clar1");
  });

  it("does nothing at all without IDs", () => {
    startAnalytics(CONTEXT, "granted", { ga4: "", clarity: "" });
    track("tool_view");
    expect(scripts()).toEqual([]);
    expect(window.dataLayer).toBeUndefined();
  });

  it("tells guests, free members and paying members apart", () => {
    const user = { id: "u", email: "a@b.co", hasPassword: false, google: false };
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
