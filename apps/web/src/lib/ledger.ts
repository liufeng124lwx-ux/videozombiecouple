import { PACKS, PLANS, productByKey, type StoryId, storyOf, TIERS } from "@vzc/catalog";
import type { LedgerEntryView } from "@vzc/contracts";
import { type MessageKey, t } from "@vzc/i18n";
import { signedCredits as signed } from "./format.ts";

/** A product key behind a grant: "pack3", "plus_month", "max_year_monthly", "upgrade_to_max_month". */
function grantProduct(reason: string) {
  if (reason.startsWith("upgrade_to_"))
    return { upgrade: true, product: productByKey(reason.slice("upgrade_to_".length)) };
  const yearly = reason.match(/^(\w+)_year_monthly$/);
  return { upgrade: false, product: productByKey(yearly ? `${yearly[1]}_year` : reason) };
}

/** The story a pack buys one film of (a Christmas pack), or undefined for a plain video pack. */
function packStory(productKey: string): StoryId | undefined {
  const story = PACKS.find((pack) => pack.productKey === productKey)?.story;
  return story && story !== "zombie" ? story : undefined;
}

/** The story a row's amount is counted in: a story hold's own, or the story pack a grant bought. */
function rowStory(entry: LedgerEntryView): StoryId | undefined {
  if (entry.story && entry.story !== "zombie") return entry.story;
  return entry.type === "grant"
    ? packStory(grantProduct(entry.reason ?? "").product?.key ?? "")
    : undefined;
}

/** Spec 5.5: what each balance change was, in words. Plan grants only appear on old accounts. */
export function ledgerLabel(entry: LedgerEntryView): string {
  const reason = entry.reason ?? "";
  switch (entry.type) {
    case "grant": {
      if (reason === "signup") return t("ledger.signup");
      if (reason === "referral") return t("ledger.referral");
      if (reason === "dispute_won") return t("ledger.disputeWon");
      const { upgrade, product } = grantProduct(reason);
      if (product?.kind === "pack") {
        const story = packStory(product.key);
        return story
          ? t(`ledger.${story}.pack` as MessageKey, {
              n: product.credits / storyOf({ story }).credits,
            })
          : t("ledger.pack");
      }
      if (product?.kind === "plan")
        return t(upgrade ? "ledger.upgrade" : "ledger.plan", { plan: PLANS[product.plan].label });
      return t("ledger.grant");
    }
    case "reserve":
      return entry.story && entry.story !== "zombie"
        ? t(`ledger.${entry.story}.video` as MessageKey)
        : t("ledger.video");
    case "release":
      return t("ledger.returned");
    case "expire":
      return t(reason === "subscription_renewed" ? "ledger.renewed" : "ledger.expired");
    case "clawback":
      return t("ledger.refund");
    case "admin_adjust":
      return t("ledger.adjust");
    default:
      return t("ledger.other");
  }
}

/**
 * Spec §7: a change of whole videos reads in videos (+3 videos, −1 video); anything else in credits.
 * A row that belongs to a story with its own price (Christmas) counts in that story's films.
 */
export function ledgerAmount(delta: number, entry?: LedgerEntryView): string {
  const story = entry ? rowStory(entry) : undefined;
  if (story) {
    const films = delta / storyOf({ story }).credits;
    if (Number.isInteger(films))
      return t(`ledger.amount.${story}.${Math.abs(films) === 1 ? "one" : "many"}` as MessageKey, {
        n: signed(films),
      });
  }
  const per = TIERS.video.credits;
  if (delta % per !== 0) return t("ledger.amount.credits", { n: signed(delta) });
  const videos = delta / per;
  return t(Math.abs(videos) === 1 ? "ledger.amount.video" : "ledger.amount.videos", {
    n: signed(videos),
  });
}
