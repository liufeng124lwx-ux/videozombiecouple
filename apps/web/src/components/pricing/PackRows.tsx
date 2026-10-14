import { t } from "@vzc/i18n";
import { useState } from "preact/hooks";
import { packCards } from "../../lib/pricing-view.ts";
import BuyButton from "./BuyButton.tsx";

type Props = { returnPath: string; preselect?: string };

/** Spec §7: video packs as ticket-stub rows (design lock), one buy button for the picked row. */
export default function PackRows({ returnPath, preselect }: Props) {
  const packs = packCards();
  const initial = preselect ?? packs.find((p) => p.popular)?.id ?? packs[0]?.id ?? "";
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
            <span class="pack-videos">
              {t(p.videos === 1 ? "pricing.oneVideo" : "pricing.nVideos", { n: p.videos })}
            </span>
            <span class="pack-each">{t("pricing.perVideo", { price: p.perVideo })}</span>
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
          label={t("pricing.buyPack", {
            what: t(pack.videos === 1 ? "pricing.oneVideo" : "pricing.nVideos", { n: pack.videos }),
            price: pack.price,
          })}
        />
      )}
      <p class="fine">{t("pricing.oneTime")}</p>
    </div>
  );
}
