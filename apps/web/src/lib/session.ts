/** The API sets this readable cookie beside the session (apps/api/src/services/session.ts hintCookie). */
export function signedInCookie(): string {
  return import.meta.env.PUBLIC_DEPLOY_ENV === "staging" ? "upx_in_stg" : "upx_in";
}

export function signedInHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").includes(`${signedInCookie()}=1`);
}
