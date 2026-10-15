import { ABUSE, FILE_LIMITS, REFUND_POLICY, REMAKES_PER_FILM, RETENTION } from "./limits.ts";
import { PACKS } from "./plans.ts";
import { CANDIDATES_PER_FRAME, CAPTION_SEC, STORYBOARD, VIDEO } from "./story.ts";
import { TIERS } from "./tiers.ts";

/** "$4.99", "$3.00": prices always with cents. */
export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

const count = (n: number) => n.toLocaleString("en-US");

function build(): Record<string, string> {
  const videosIn = (credits: number) => credits / TIERS.video.credits;
  const out: Record<string, string> = {
    "remakes.perFilm": count(REMAKES_PER_FILM),
    "candidates.perFrame": count(CANDIDATES_PER_FRAME),
    "video.seconds": count(STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC),
    "video.width": String(VIDEO.width),
    "video.height": String(VIDEO.height),
    "retention.photosDays": count(RETENTION.workDays),
    "retention.guestFilmDays": count(RETENTION.guestFilmDays),
    "retention.memberFilmDays": count(RETENTION.memberFilmDays),
    "retention.linkMinutes": count(RETENTION.signedUrlSeconds / 60),
    "file.maxMb": count(FILE_LIMITS.maxBytes / 1_000_000),
    "refund.packDays": count(REFUND_POLICY.packDays),
    "age.minEstimated": count(ABUSE.minEstimatedAge),
  };
  let cheapest = Number.POSITIVE_INFINITY;
  for (const pack of PACKS) {
    const videos = videosIn(pack.credits);
    const perVideo = pack.usd / videos;
    cheapest = Math.min(cheapest, perVideo);
    out[`pack.${pack.id}.usd`] = usd(pack.usd);
    out[`pack.${pack.id}.videos`] = count(videos);
    out[`pack.${pack.id}.perVideo`] = usd(perVideo);
  }
  out["price.fromPerVideo"] = usd(cheapest);
  return out;
}

let cache: Record<string, string> | null = null;

/** Every number a page may show, by key. */
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
