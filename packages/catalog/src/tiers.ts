export const TIER_IDS = ["std", "pro", "4k"] as const;
export type TierId = (typeof TIER_IDS)[number];

export type Tier = { id: TierId; label: string; credits: number; longEdge: number };

/** Spec 6.8: 1 credit = 1 standard photo. */
export const TIERS: Record<TierId, Tier> = {
  std: { id: "std", label: "Standard", credits: 1, longEdge: 2048 },
  pro: { id: "pro", label: "Pro", credits: 3, longEdge: 2048 },
  "4k": { id: "4k", label: "4K", credits: 6, longEdge: 4096 },
};
