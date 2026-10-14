/** features.md §13 plus spec §9 additions. The server reports `purchase`. */
export const EVENT_NAMES = [
  "tool_view",
  "upload_start",
  "upload_success",
  "upload_error",
  "sample_click",
  "job_submit",
  "job_success",
  "job_fail",
  "compare_interact",
  "download",
  "quota_exhausted",
  "paywall_view",
  "paywall_click",
  "signup",
  "login",
  "pricing_view",
  "checkout_start",
  "purchase",
  "local_tool_run",
  "editor_download",
  "feedback",
  "rerun",
  "fallback_shown",
  "checkout_return",
  "restore_state",
  "consent",
  "diagnosis",
  "mode_change",
  "guard_fail",
  "free_retry",
  "refine_use",
  "compare_mode",
  "version_pick",
  "share_card",
  "hero_ring",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Attached to every event (spec 9). */
export type CommonEventProps = {
  lang: string;
  page_id: string;
  user_kind: "guest" | "free" | "paid";
};
