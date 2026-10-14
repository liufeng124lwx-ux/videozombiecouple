import type { BuildMode } from "@vzc/catalog";

type Env = { PUBLIC_DEPLOY_ENV?: string | undefined; PUBLIC_SITE_ORIGIN?: string | undefined };

/** Spec 2.1: only a production build leaves drafts out and lets search engines in. */
export function buildMode(env: Env = import.meta.env): BuildMode {
  return env.PUBLIC_DEPLOY_ENV === "production" ? "production" : "preview";
}

export function siteOrigin(env: Env = import.meta.env): string {
  return (env.PUBLIC_SITE_ORIGIN || "https://videozombiecouple.com").replace(/\/+$/, "");
}

/** Spec 2.4: no trailing slash, except the bare origin. */
export function absoluteUrl(path: string, env: Env = import.meta.env): string {
  return path === "/" ? `${siteOrigin(env)}/` : `${siteOrigin(env)}${path}`;
}
