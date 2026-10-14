/**
 * Spec 11.2: after a production deploy, tell IndexNow (Bing, Yandex, …) about the pages that the
 * previous deploy didn't have.
 *
 *   tsx scripts/indexnow.ts snapshot https://videozombiecouple.com /tmp/before.xml   (before deploying)
 *   tsx scripts/indexnow.ts submit /tmp/before.xml dist                     (after deploying)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

/** Public by design: IndexNow checks that https://videozombiecouple.com/<key>.txt holds it. */
export const INDEXNOW_KEY = "f0b6568469ed0736d373b2f3b5fe7f85";
const SITE = "https://videozombiecouple.com";

export function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1] ?? "");
}

export function newUrls(before: string, after: string): string[] {
  const seen = new Set(locs(before));
  return locs(after).filter((url) => !seen.has(url) && !url.endsWith(".xml"));
}

export function indexNowBody(urlList: string[], key = INDEXNOW_KEY) {
  return { host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList };
}

/** Every page sitemap the live site lists (empty before the first launch). */
async function snapshot(site: string): Promise<string> {
  const index = await fetch(`${site}/sitemap-index.xml`).catch(() => null);
  if (!index?.ok) return "";
  const maps = await Promise.all(
    locs(await index.text()).map(async (url) => {
      const response = await fetch(url).catch(() => null);
      return response?.ok ? response.text() : "";
    }),
  );
  return maps.join("\n");
}

function built(dir: string): string {
  return readdirSync(dir)
    .filter((f) => /^sitemap-.+\.xml$/.test(f) && f !== "sitemap-index.xml")
    .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
    .join("\n");
}

async function main(): Promise<void> {
  const [command, a, b] = process.argv.slice(2);
  if (command === "snapshot" && a && b) {
    writeFileSync(b, await snapshot(a));
    console.log(`indexnow: saved the live sitemap (${locs(readFileSync(b, "utf8")).length} urls)`);
    return;
  }
  if (command === "submit" && a && b) {
    const urls = newUrls(readFileSync(a, "utf8"), built(b));
    if (urls.length === 0) {
      console.log("indexnow: nothing new");
      return;
    }
    const response = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(indexNowBody(urls.slice(0, 10_000))),
    });
    // 200 and 202 both mean accepted; anything else is worth a look but must not fail a deploy.
    console.log(`indexnow: submitted ${urls.length} urls → ${response.status}`);
    return;
  }
  console.error("usage: indexnow.ts snapshot <site> <file> | submit <file> <dist>");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
