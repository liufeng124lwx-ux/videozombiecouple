import { fact, isLive, PAGES, pagePath } from "@vzc/catalog";

/** /llms.txt (GEO): a plain summary for AI assistants, numbers from the catalog, live pages only. */
export function llmsTxt(origin: string): string {
  const pages = PAGES.filter((p) => isLive(p) && !p.noindex && p.kind !== "legal");
  return [
    "# VideoZombieCouple",
    "",
    `> Make a ${fact("video.seconds")}-second AI "zombie love story" video from two photos: a cold standoff where one of you has turned, an embrace, then a match cut to a warm golden-hour memory. See the two key frames free first, then pay per video (from ${fact("price.fromPerVideo")}).`,
    "",
    "## Facts",
    `- Free preview: two key frames (standoff and memory), ${fact("preview.daily")} a day with a free account.`,
    `- Video: ${fact("video.seconds")} seconds, vertical ${fact("video.width")}×${fact("video.height")} MP4 with music and an optional end title.`,
    `- Price: ${fact("pack.pack1.usd")} for one video, ${fact("pack.pack3.usd")} for ${fact("pack.pack3.videos")}, ${fact("pack.pack10.usd")} for ${fact("pack.pack10.videos")}. One-time packs, no subscription.`,
    `- Privacy: photos deleted within ${fact("retention.photosDays")} days, videos within ${fact("retention.videoDays")} days; face features are never stored or used for training.`,
    "- Adults only; no gore. Not affiliated with TikTok or the creators of the original viral clip.",
    "",
    "## Pages",
    ...pages.map((p) => `- [${p.locales.en.h1}](${origin}${pagePath(p)})`),
    "",
  ].join("\n");
}
