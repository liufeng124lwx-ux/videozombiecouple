import type { Bindings } from "../types.ts";

/** Spec 5.4: the community-maintained blocklist (one domain per line). */
export const DISPOSABLE_LIST =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";

/** Weekly: refresh `disposable:domains`; a failed download keeps last week's list. */
export async function refreshDisposable(
  env: Bindings,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const response = await fetchImpl(DISPOSABLE_LIST);
  if (!response.ok) throw new Error(`blocklist ${response.status}`);
  const domains = (await response.text())
    .split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line && !line.startsWith("#"));
  if (domains.length === 0) throw new Error("blocklist is empty");
  await env.KV.put("disposable:domains", JSON.stringify(domains));
  return domains.length;
}
