import type { LocaleId, PageKind } from "@vzc/catalog";
import type { EventName } from "@vzc/contracts";
import { useEffect } from "preact/hooks";
import { startAnalytics, track, userKind } from "../../lib/analytics.ts";
import { effectiveConsent, storedConsent } from "../../lib/consent.ts";
import { loadMe } from "../../lib/me.ts";

const VIEW_EVENTS: Partial<Record<PageKind, EventName>> = {
  home: "tool_view",
  landing: "tool_view",
  pricing: "pricing_view",
};

type Props = { pageId: string; kind: PageKind | null; locale: LocaleId };

/** Starts analytics for this page once we know the visitor's region and account (spec 9). */
export default function AnalyticsBoot({ pageId, kind, locale }: Props) {
  useEffect(() => {
    void loadMe().then((me) => {
      const stored = storedConsent();
      const consent = effectiveConsent(stored, me?.consentRequired ?? true);
      startAnalytics(
        { lang: locale, page_id: pageId, user_kind: userKind(me) },
        consent,
        undefined,
        {
          explicit: stored === "granted",
        },
      );
      const view = kind ? VIEW_EVENTS[kind] : undefined;
      if (view) track(view);
    });
  }, []);
  return null;
}
