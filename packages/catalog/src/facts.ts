import { FILE_LIMITS, LOCAL_TOOLS, QUOTA, REFUND_POLICY, RETENTION } from "./limits.ts";
import { BONUSES, PACKS, PLAN_IDS, PLANS } from "./plans.ts";
import { minCreditPrice } from "./pricing.ts";
import { TIER_IDS, TIERS } from "./tiers.ts";
import { LOCAL_LIMITS } from "./tools.ts";

/** "$9.9", "$4.99", "$94.8": the short form the PRD and the pricing mockup use. */
export function usd(amount: number): string {
  return `$${Number(amount.toFixed(2))}`;
}

const count = (n: number) => n.toLocaleString("en-US");
const resolution = (longEdge: number) => `${Math.round(longEdge / 1024)}K`;
const size = (kb: number) => (kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`);

function build(): Record<string, string> {
  const proCredits = TIERS.pro.credits;
  const out: Record<string, string> = {
    "quota.guestDaily": count(QUOTA.guestDaily),
    "quota.userDaily": count(QUOTA.userDaily),
    "retention.freeHours": count(RETENTION.freeHours),
    "retention.creditDays": count(RETENTION.creditDays),
    "retention.linkMinutes": count(RETENTION.signedUrlSeconds / 60),
    "file.maxMb": count(FILE_LIMITS.maxBytes / 1_000_000),
    "file.maxMegapixels": count(FILE_LIMITS.maxMegapixels),
    "bonus.signup": count(BONUSES.signup),
    "refund.packDays": count(REFUND_POLICY.packDays),
    "refund.subscriptionDays": count(REFUND_POLICY.subscriptionDays),
    "refund.subscriptionMaxUsed": `${Math.round(REFUND_POLICY.subscriptionMaxUsedShare * 100)}%`,
    "gif.maxFiles": count(LOCAL_TOOLS.compressGif.maxFiles),
    "price.minPerCredit": `$${minCreditPrice().toFixed(3)}`,
    "local.maxFiles": count(LOCAL_LIMITS.maxFiles),
    "local.maxMegapixels": count(LOCAL_LIMITS.maxMegapixels),
  };
  LOCAL_TOOLS.compressGif.targetsKb.forEach((kb, i) => {
    out[`gif.target${i + 1}`] = size(kb);
  });
  LOCAL_LIMITS.targetsKb.forEach((kb, i) => {
    out[`local.target${i + 1}`] = size(kb);
  });
  for (const id of TIER_IDS) {
    out[`tier.${id}.credits`] = count(TIERS[id].credits);
    out[`tier.${id}.resolution`] = resolution(TIERS[id].longEdge);
  }
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    out[`plan.${id}.credits`] = count(plan.monthlyCredits);
    out[`plan.${id}.proPhotos`] = count(Math.floor(plan.monthlyCredits / proCredits));
    out[`plan.${id}.monthly`] = usd(plan.month.usd);
    out[`plan.${id}.yearly`] = usd(plan.year.usd);
    out[`plan.${id}.yearlyPerMonth`] = usd(plan.year.usdPerMonth);
  }
  for (const pack of PACKS) {
    out[`pack.${pack.id}.credits`] = count(pack.credits);
    out[`pack.${pack.id}.proPhotos`] = count(Math.floor(pack.credits / proCredits));
    out[`pack.${pack.id}.usd`] = usd(pack.usd);
  }
  return out;
}

let cache: Record<string, string> | null = null;

/** Every number a page may show, by key (spec 2.2). */
export function facts(): Readonly<Record<string, string>> {
  cache ??= build();
  return cache;
}

export function fact(key: string): string {
  const value = facts()[key];
  if (value === undefined) throw new Error(`Unknown fact "${key}"`);
  return value;
}

/** Fills `{{key}}` with facts; an unknown key throws, which fails the build. */
export function interpolate(text: string): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => fact(key));
}
