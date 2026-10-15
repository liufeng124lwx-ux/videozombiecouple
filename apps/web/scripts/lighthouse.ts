/**
 * Spec 11.1: Lighthouse on the production build — the home page, the landing page and pricing — with
 * the mobile thresholds: performance ≥ 90, LCP < 2.5 s, CLS < 0.1. Each page runs three times and
 * the median counts, since CI machines vary.
 *
 *   pnpm --filter @vzc/web lighthouse
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

const PORT = 4399;
const ORIGIN = `http://localhost:${PORT}`;
const RUNS = 3;
const MIN_SCORE = 90;
const MAX_LCP_MS = 2500;
const MAX_CLS = 0.1;

type Result = { score: number; lcp: number; cls: number; why?: string };

/** The home page (with the story tool), the landing page that carries the tool too, and pricing. */
function pages(): string[] {
  const landing = readdirSync("dist")
    .filter((f) => f.endsWith(".html") && f !== "index.html")
    .find((f) => readFileSync(`dist/${f}`, "utf8").includes('id="make"'));
  return ["/", ...(landing ? [`/${landing.replace(/\.html$/, "")}`] : []), "/pricing"];
}

async function serve(): Promise<ChildProcess> {
  const server = spawn("pnpm", ["exec", "astro", "preview", "--port", String(PORT)], {
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) return server;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  server.kill();
  throw new Error("preview server did not start");
}

/** Which element was the LCP and where its time went, so a CI failure can be read from the log. */
function lcpWhy(lhr: any): string {
  const items = lhr.audits["lcp-breakdown-insight"]?.details?.items ?? [];
  const node = items.find((i: { type?: string }) => i.type === "node");
  const parts = (items.find((i: { type?: string }) => i.type === "table")?.items ?? [])
    .map(
      (p: { subpart?: string; duration?: number }) =>
        `${p.subpart} ${Math.round(p.duration ?? 0)}ms`,
    )
    .join(", ");
  return `${node?.selector ?? "?"}${parts ? ` (${parts})` : ""}`;
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

async function measure(port: number, url: string): Promise<Result> {
  const runs: Result[] = [];
  for (let i = 0; i < RUNS; i++) {
    const result = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"],
      formFactor: "mobile",
    });
    const lhr = result?.lhr;
    if (!lhr) throw new Error(`no Lighthouse result for ${url}`);
    runs.push({
      score: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      lcp: lhr.audits["largest-contentful-paint"]?.numericValue ?? Number.POSITIVE_INFINITY,
      cls: lhr.audits["cumulative-layout-shift"]?.numericValue ?? Number.POSITIVE_INFINITY,
      why: lcpWhy(lhr),
    });
  }
  const mid = [...runs].sort((a, b) => a.lcp - b.lcp)[Math.floor(runs.length / 2)];
  return {
    why: mid?.why ?? "?",
    score: median(runs.map((r) => r.score)),
    lcp: median(runs.map((r) => r.lcp)),
    cls: median(runs.map((r) => r.cls)),
  };
}

async function report(port: number, path: string, failures: string[]) {
  const r = await measure(port, `${ORIGIN}${path}`);
  console.log(
    `lighthouse ${path}: performance ${r.score}, LCP ${Math.round(r.lcp)} ms, CLS ${r.cls.toFixed(3)} — LCP element ${r.why}`,
  );
  if (r.score < MIN_SCORE) failures.push(`${path}: performance ${r.score} < ${MIN_SCORE}`);
  if (r.lcp >= MAX_LCP_MS) failures.push(`${path}: LCP ${Math.round(r.lcp)} ms ≥ ${MAX_LCP_MS}`);
  if (r.cls >= MAX_CLS) failures.push(`${path}: CLS ${r.cls.toFixed(3)} ≥ ${MAX_CLS}`);
  // The banner waits for /v1/me, so it paints late; as the LCP element it cost 5 s on a slow
  // CI runner. Keep its copy shorter than the hero's lede (packages/i18n "cookie.text").
  if (r.why?.includes("div.cookie"))
    failures.push(`${path}: the cookie banner is the LCP element; shorten "cookie.text"`);
}

async function main() {
  const failures: string[] = [];
  for (const [script, paths] of [["build:production", pages]] as const) {
    const build = spawnSync("pnpm", [script], { stdio: "inherit" });
    if (build.status !== 0) throw new Error(`${script} failed`);
    const server = await serve();
    const chrome = await chromeLauncher.launch({
      chromePath: chromium.executablePath(),
      chromeFlags: ["--headless=new", "--no-sandbox"],
    });
    try {
      for (const path of paths()) await report(chrome.port, path, failures);
    } finally {
      chrome.kill();
      server.kill();
    }
  }
  if (failures.length > 0) {
    console.error(`lighthouse: ${failures.length} failed\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("lighthouse: OK");
}

await main();
