import type { BuiltPage } from "./checks.ts";

export const ORIGIN = "https://videozombiecouple.com";
const TITLE = "Zombie Video Couple – AI Zombie Love Story From Photos";
const DESCRIPTION =
  "Turn two photos into a short zombie love story film. See the standoff and the memory free before you pay. One-time packs, no subscription.";

export type Parts = {
  title?: string;
  description?: string;
  canonical?: string | null;
  robots?: string;
  h1s?: string[];
  head?: string;
  body?: string;
};

/** A built page the way BaseLayout writes it, with the parts a test wants to change. */
export function html(parts: Parts = {}): string {
  const canonical = parts.canonical === undefined ? `${ORIGIN}/` : parts.canonical;
  return [
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${parts.title ?? TITLE}</title>`,
    `<meta name="description" content="${parts.description ?? DESCRIPTION}">`,
    canonical === null ? "" : `<link rel="canonical" href="${canonical}">`,
    parts.robots ? `<meta name="robots" content="${parts.robots}">` : "",
    parts.head ?? "",
    `</head><body><main id="main">`,
    ...(parts.h1s ?? ["Zombie Video Couple"]).map((h) => `<h1 data-astro-cid-abc>${h}</h1>`),
    parts.body ?? "",
    "</main></body></html>",
  ].join("");
}

export function built(overrides: Partial<BuiltPage> = {}): BuiltPage {
  return {
    path: "/",
    locale: "en",
    h1: "Zombie Video Couple",
    kind: "home",
    indexable: true,
    draft: false,
    html: html(),
    ...overrides,
  };
}
