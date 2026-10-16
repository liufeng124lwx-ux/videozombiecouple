import {
  PACKS as ALL_PACKS,
  VIDEO_PACKS as PACKS,
  SALE_PRODUCTS,
  type StoryId,
  TIERS,
  usd,
} from "@vzc/catalog";

export type PackCard = {
  id: string;
  videos: number;
  price: string;
  perVideo: string;
  productKey: string;
  popular: boolean;
  /** Saving per video against the single-video pack, e.g. "20%"; null for that pack. */
  saving: string | null;
  /** Set on a story's own pack (one film of that story, not N videos). */
  story?: StoryId;
};

/** Spec §7: one-time video packs; every number comes from the catalog. */
export function packCards(): PackCard[] {
  const single = PACKS[0];
  const base = single ? single.usd / (single.credits / TIERS.video.credits) : 0;
  return PACKS.map((pack) => {
    const videos = pack.credits / TIERS.video.credits;
    const each = pack.usd / videos;
    const saving = base > 0 ? Math.round((1 - each / base) * 100) : 0;
    return {
      id: pack.id,
      videos,
      price: usd(pack.usd),
      perVideo: usd(each),
      productKey: pack.productKey,
      popular: pack.badge === "popular",
      saving: saving > 0 ? `${saving}%` : null,
    };
  });
}

/** On a story's tool: that story's own pack first, then the video packs (any credits work). */
export function packCardsFor(story?: StoryId): PackCard[] {
  const own = ALL_PACKS.filter(
    (pack) =>
      story !== undefined &&
      pack.story === story &&
      SALE_PRODUCTS.some((product) => product.key === pack.productKey),
  );
  return [
    ...own.map((pack) => ({
      id: pack.id,
      videos: 1,
      price: usd(pack.usd),
      perVideo: usd(pack.usd),
      productKey: pack.productKey,
      popular: false,
      saving: null,
      ...(pack.story ? { story: pack.story } : {}),
    })),
    ...packCards(),
  ];
}
