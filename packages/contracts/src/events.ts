/** Spec §6 埋点 plus the reused account/billing events. The server reports `purchase`. */
export const EVENT_NAMES = [
  "tool_view",
  "upload_start",
  "upload_error",
  "preview_start",
  "preview_done",
  "video_purchase",
  "video_done",
  "download",
  "share",
  "retitle",
  "quota_exhausted",
  "paywall_view",
  "signup",
  "login",
  "pricing_view",
  "checkout_start",
  "purchase",
  "checkout_return",
  "consent",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Attached to every event (spec 9). */
export type CommonEventProps = {
  lang: string;
  page_id: string;
  user_kind: "guest" | "free" | "paid";
};
