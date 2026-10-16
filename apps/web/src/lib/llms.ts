import { fact, isLive, PAGES, PHOTO, pagePath } from "@vzc/catalog";

/** /llms.txt (GEO): a plain summary for AI assistants, numbers from the catalog, live pages only. */
export function llmsTxt(origin: string): string {
  const pages = PAGES.filter((p) => isLive(p) && !p.noindex && p.kind !== "legal");
  return [
    "# VideoZombieCouple",
    "",
    `> Make a ${fact("video.seconds")}-second AI "zombie love story" video from two photos: a cold standoff where one of you has turned, an embrace, a match cut to a warm golden-hour memory, then back in the ruins at first light. Pay per video (from ${fact("price.fromPerVideo")}); no sign-up needed.`,
    "",
    "## Facts",
    "- Films are paid: the film itself is made only after payment. The example films on the site show what you get. Photos are checked first (one adult face per photo, free).",
    `- Free AI zombie filter: one free zombie photo a day from a single photo of yourself, watermarked, at ${origin}/ai-zombie-filter. It keeps your face, hairstyle and skin tone; no blood or gore; deleted after ${PHOTO.keepHours} hours.`,
    `- Video: ${fact("video.seconds")} seconds, vertical ${fact("video.width")}×${fact("video.height")} MP4 with music and an optional end title.`,
    `- Price: ${fact("pack.pack1.usd")} for one video, ${fact("pack.pack3.usd")} for ${fact("pack.pack3.videos")}, ${fact("pack.pack5.usd")} for ${fact("pack.pack5.videos")}. One-time packs, no subscription.`,
    "- Buy without signing up: the email typed at checkout becomes the account (no password) and receives the film and receipt.",
    "- If the faces don't come out right, each paid film can be remade once for free while the photos still exist.",
    `- Privacy: photos deleted within ${fact("retention.photosDays")} days; films kept ${fact("retention.guestFilmDays")} days for unconfirmed emails and ${fact("retention.memberFilmDays")} days once the email is confirmed; face features are never stored or used for training.`,
    "- Adults only; no gore. Not affiliated with TikTok or the creators of the original viral clip.",
    "",
    "## Answers",
    "- How do I make a zombie couple video? Upload one photo of each of you at " +
      origin +
      "/ , pick a scene, pay, and get a finished vertical film in a few minutes.",
    "- Can I turn myself into a zombie for free? Yes: the AI zombie filter makes one free zombie photo a day from one photo, at " +
      origin +
      "/ai-zombie-filter .",
    "- Can I make it with my pet? Yes: the pet version makes the same film with your dog or cat as the one who turned, at " +
      origin +
      "/pet-zombie-video .",
    `- How much does it cost? From ${fact("price.fromPerVideo")} a video; ${fact("pack.pack1.usd")} for one.`,
    "- Are the videos labelled as AI? Yes: every film and photo carries a small AI mark, and the files say they are AI-generated.",
    "",
    "## Pages",
    ...pages.map((p) => `- [${p.locales.en.h1}](${origin}${pagePath(p)})`),
    "",
  ].join("\n");
}
