import type { StoryId } from "@vzc/catalog";
import { type MessageKey, t } from "@vzc/i18n";
import { useState } from "preact/hooks";
import { type PackCard, packCardsFor } from "../../lib/pricing-view.ts";
import BuyButton from "./BuyButton.tsx";

type Props = {
  returnPath: string;
  preselect?: string;
  story?: StoryId;
  /** Credits the buyer already holds; they count towards a story's price. */
  balance?: number;
  /** The pricing page: every video pack, with the story's own pack first. */
  allPacks?: boolean;
};

/** "1 Christmas film" for a story's pack, otherwise "N videos". */
const what = (p: PackCard) =>
  p.story
    ? t(`story.${p.story}.pack` as MessageKey, { n: p.videos })
    : t(p.videos === 1 ? "pricing.oneVideo" : "pricing.nVideos", { n: p.videos });

function buyParam(): string | null {
  return typeof location === "undefined" ? null : new URLSearchParams(location.search).get("buy");
}

/** Spec §7: video packs as ticket-stub rows (design lock), one buy button for the picked row. */
export default function PackRows({ returnPath, preselect, story, balance = 0, allPacks }: Props) {
  const packs = packCardsFor(story, allPacks ? Number.POSITIVE_INFINITY : balance);
  // A sign-in redirect comes back as ?buy=<product>; that pack must be the picked one for its buy
  // button to continue the purchase.
  const bought = buyParam();
  const initial =
    preselect ??
    packs.find((p) => p.productKey === bought || p.id === bought)?.id ??
    // On a story's tool its own film is the default; the pricing page keeps the popular pack.
    (allPacks ? undefined : packs.find((p) => p.story)?.id) ??
    packs.find((p) => p.popular)?.id ??
    packs[0]?.id ??
    "";
  const [picked, setPicked] = useState(initial);
  const pack = packs.find((p) => p.id === picked) ?? packs[0];
  return (
    <div class="packs">
      <fieldset class="pack-rows">
        <legend class="visually-hidden">{t("pricing.pickPack")}</legend>
        {packs.map((p) => (
          <label class={`pack-row${p.id === picked ? " on" : ""}`} key={p.id}>
            <input
              type="radio"
              name="pack"
              value={p.id}
              checked={p.id === picked}
              onChange={() => setPicked(p.id)}
            />
            <span class="pack-videos">{what(p)}</span>
            {!p.story && (
              <span class="pack-each">{t("pricing.perVideo", { price: p.perVideo })}</span>
            )}
            {p.popular && <span class="badge">{t("pricing.mostPicked")}</span>}
            {p.saving && !p.popular && (
              <span class="pack-save">{t("pricing.save", { pct: p.saving })}</span>
            )}
            <span class="pack-price">{p.price}</span>
          </label>
        ))}
      </fieldset>
      {pack && (
        <BuyButton
          key={pack.id}
          productKey={pack.productKey}
          primary
          returnPath={returnPath}
          label={t("pricing.buyPack", { what: what(pack), price: pack.price })}
        />
      )}
      <p class="fine">{t("pricing.oneTime")}</p>
    </div>
  );
}
