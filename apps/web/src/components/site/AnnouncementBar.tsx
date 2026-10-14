import type { Banner } from "@vzc/contracts";
import { t } from "@vzc/i18n";
import { useEffect, useState } from "preact/hooks";
import { loadMe } from "../../lib/me.ts";

const KEY = "upx-banner-closed";

function closedText(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Design S17: one line above the header, never yellow; dismissing hides this text for good. */
export default function AnnouncementBar() {
  const [banner, setBanner] = useState<Banner | null>(null);

  useEffect(() => {
    void loadMe().then((me) => {
      const next = me?.banner ?? null;
      if (next && closedText() !== next.text) setBanner(next);
    });
  }, []);

  if (!banner) return null;
  return (
    <div class="announce" role="region" aria-label={t("banner.label")}>
      <div class="wrap">
        {banner.href ? <a href={banner.href}>{banner.text}</a> : <span>{banner.text}</span>}
        <button
          type="button"
          class="x"
          aria-label={t("banner.close")}
          onClick={() => {
            try {
              localStorage.setItem(KEY, banner.text);
            } catch {}
            setBanner(null);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
