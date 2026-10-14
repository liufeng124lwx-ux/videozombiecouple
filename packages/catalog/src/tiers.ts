export const TIER_IDS = ["preview", "video"] as const;
export type TierId = (typeof TIER_IDS)[number];

export type Tier = { id: TierId; label: string; credits: number };

/** Spec §7: shown to users as "1 video"; credits keep room for pricier variants later. */
export const VIDEO_CREDITS = 10;

/** A preview is free (daily quota); a finished video costs VIDEO_CREDITS. */
export const TIERS: Record<TierId, Tier> = {
  preview: { id: "preview", label: "Preview", credits: 0 },
  video: { id: "video", label: "Video", credits: VIDEO_CREDITS },
};
