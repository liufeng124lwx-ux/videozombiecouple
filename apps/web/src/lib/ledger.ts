import { PLANS, productByKey, TIERS } from "@vzc/catalog";
import type { LedgerEntryView } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { signedCredits as signed } from "./format.ts";

/** A product key behind a grant: "pack3", "plus_month", "max_year_monthly", "upgrade_to_max_month". */
function grantProduct(reason: string) {
  if (reason.startsWith("upgrade_to_"))
    return { upgrade: true, product: productByKey(reason.slice("upgrade_to_".length)) };
  const yearly = reason.match(/^(\w+)_year_monthly$/);
  return { upgrade: false, product: productByKey(yearly ? `${yearly[1]}_year` : reason) };
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
      if (product?.kind === "pack") return t("ledger.pack");
      if (product?.kind === "plan")
        return t(upgrade ? "ledger.upgrade" : "ledger.plan", { plan: PLANS[product.plan].label });
      return t("ledger.grant");
    }
    case "reserve":
      return t("ledger.video");
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

/** Spec §7: a change of whole videos reads in videos (+3 videos, −1 video); anything else in credits. */
export function ledgerAmount(delta: number): string {
  const per = TIERS.video.credits;
  if (delta % per !== 0) return t("ledger.amount.credits", { n: signed(delta) });
  const videos = delta / per;
  return t(Math.abs(videos) === 1 ? "ledger.amount.video" : "ledger.amount.videos", {
    n: signed(videos),
  });
}
