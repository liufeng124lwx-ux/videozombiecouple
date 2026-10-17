import { type LocaleId, pageEntries, type StoryId } from "@vzc/catalog";
import { t } from "@vzc/i18n";
import "@vzc/i18n/all";
import type { APIRoute, GetStaticPaths } from "astro";
import { renderOg } from "../../../lib/og.ts";
import { buildMode } from "../../../lib/site.ts";
import { ogFrames } from "../../../lib/story-landing.ts";

/** Spec 2.4: one share image per built page, generated at build time. */
export const getStaticPaths: GetStaticPaths = () =>
  pageEntries(buildMode()).map((entry) => ({
    params: { locale: entry.locale, id: entry.page.id },
    props: {
      title: entry.page.locales[entry.locale]?.h1 ?? "VideoZombieCouple",
      story: entry.page.preset?.story ?? "zombie",
    },
  }));

export const GET: APIRoute = async ({ params, props }) => {
  const locale = params.locale as LocaleId;
  const frames = ogFrames(props.story as StoryId);
  const labels = {
    before: t(frames.labels.before, {}, locale),
    after: t(frames.labels.after, {}, locale),
  };
  const jpg = await renderOg(String(props.title), frames.sample, labels);
  return new Response(jpg, { headers: { "content-type": "image/jpeg" } });
};
