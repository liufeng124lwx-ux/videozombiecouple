import { type LocaleId, pageEntries } from "@vzc/catalog";
import { t } from "@vzc/i18n";
import type { APIRoute, GetStaticPaths } from "astro";
import { renderOg } from "../../../lib/og.ts";
import { buildMode } from "../../../lib/site.ts";

/** Spec 2.4: one share image per built page, generated at build time. */
export const getStaticPaths: GetStaticPaths = () =>
  pageEntries(buildMode()).map((entry) => ({
    params: { locale: entry.locale, id: entry.page.id },
    props: { title: entry.page.locales[entry.locale]?.h1 ?? "VideoZombieCouple" },
  }));

export const GET: APIRoute = async ({ params, props }) => {
  const locale = params.locale as LocaleId;
  const labels = { before: t("og.before", {}, locale), after: t("og.after", {}, locale) };
  const jpg = await renderOg(String(props.title), null, labels);
  return new Response(jpg, { headers: { "content-type": "image/jpeg" } });
};
