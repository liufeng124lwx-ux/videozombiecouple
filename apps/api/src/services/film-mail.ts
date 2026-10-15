import { CAPTION_SEC, RETENTION, STORYBOARD } from "@vzc/catalog";
import type { Bindings } from "../types.ts";
import { issueLinkToken } from "./codes.ts";

const day = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The film-ready email and the reminder the day before deletion (owner, 2026-10-15: remind early).
 * Both say when the film is deleted. For a buyer who never verified their email, the link signs
 * them in (proving the email), which keeps the film for 30 days instead of 3.
 */
export async function filmMail(
  env: Bindings,
  o: { storyId: string; email: string; verified: boolean; expiresAt: number; reminder: boolean },
): Promise<{ to: string; subject: string; intro: string; link: { href: string; label: string } }> {
  const seconds = STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC;
  const story = `/story?id=${o.storyId}`;
  let href = `${env.ALLOWED_ORIGIN}${story}`;
  if (!o.verified) {
    const token = await issueLinkToken(env, o.email, Math.max(o.expiresAt - Date.now(), 60_000));
    href = `${env.ALLOWED_ORIGIN}/account?login=${token}&next=${encodeURIComponent(story)}`;
  }
  const deleted = `It will be deleted on ${day(o.expiresAt)}, so download it before then.`;
  const longer = o.verified
    ? ""
    : ` Open it with the button below to confirm your email and we'll keep it for ${RETENTION.memberFilmDays} days.`;
  return o.reminder
    ? {
        to: o.email,
        subject: "Your zombie love story is deleted tomorrow",
        intro: `A reminder: your film will be deleted tomorrow (${day(o.expiresAt)}). Download it now if you want to keep it.${longer}`,
        link: { href, label: "Download your film" },
      }
    : {
        to: o.email,
        subject: "Your zombie love story is ready",
        intro: `Your ${seconds}-second film is ready to watch and download. ${deleted}${longer}`,
        link: { href, label: "Watch your film" },
      };
}
