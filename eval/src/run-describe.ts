// R0 (christmas content spec §5): each describe model reads each pair's two photos once.
//   node eval/src/run-describe.ts --run r0 [--models claude-haiku-5-5,gemini-3-6-flash-openai] [--pairs p01,p02] [--resume] [--yes]
// Without --yes: prints the plan and the estimate only. Outputs go to eval/results/<run>/:
// describe.csv (pair, model, ok, survivor, infected, dropped) and the raw answers in raw/*.txt.
// The request mirrors packages/providers KieDescriber (Node's strip-only TypeScript cannot load
// its parameter properties); the answer is read with probe-describe's answerText and parsed by
// the catalog's parseAppearance, exactly as the API does. The key is never printed.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DESCRIBE_PROMPT, parseAppearance, ROUTES, type Appearance, type RouteSeed } from "../../packages/catalog/src/index.ts";
import { loadKey } from "./env.ts";
import { KieClient, KieError, UploadCache } from "./kie.ts";
import { loadPairs, type Pair } from "./personas.ts";
import { answerText } from "./probe-describe.ts";
import { DESCRIBE_USD, isQuotaError, meter, QUOTA_MESSAGE, usd } from "./spend.ts";

const EVAL = resolve(import.meta.dirname, "..");
export const R0_PAIRS = ["p01", "p02", "p03", "p06", "p07", "p09"];

/** The describe routes in rank order (primary first), straight from the catalog. */
export function describeRoutes(only?: string[]): RouteSeed[] {
  const all = ROUTES.filter((r) => r.capability === "describe").sort((a, b) => a.rank - b.rank);
  if (!only) return all;
  const picked = only.map((m) => all.find((r) => r.model === m));
  const unknown = only.filter((_, i) => !picked[i]);
  if (unknown.length) throw new Error(`unknown describe model(s): ${unknown.join(", ")} (catalog has ${all.map((r) => r.model).join(", ")})`);
  return picked as RouteSeed[];
}

/** Comma-separated items on the IMAGE n lines of the raw answer that the parser did not keep. */
export function droppedCount(raw: string, kept: Appearance): number {
  const items = (n: 1 | 2) =>
    raw
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*[-*•]?\\s*image\\s*${n}\\s*:`, "i").test(l))
      ?.replace(/^[^:]*:/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length ?? 0;
  const keptCount = (s: string) => (s ? s.split(", ").length : 0);
  return Math.max(0, items(1) - keptCount(kept.survivor)) + Math.max(0, items(2) - keptCount(kept.infected));
}

/** One synchronous describe call; throws KieError with the body code on failure. Returns the raw text. */
export async function describeOnce(key: string, route: RouteSeed, images: string[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const claude = route.model.startsWith("claude-");
  const url = claude ? "https://api.kie.ai/claude/v1/messages" : `https://api.kie.ai/${route.model}/v1/chat/completions`;
  const content = claude
    ? [...images.map((u) => ({ type: "image", source: { type: "url", url: u } })), { type: "text", text: DESCRIBE_PROMPT }]
    : [...images.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: DESCRIBE_PROMPT }];
  const body = claude ? { model: route.model, max_tokens: 200, messages: [{ role: "user", content }] } : { messages: [{ role: "user", content }], stream: false };
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(route.timeoutMs),
  });
  const parsed: unknown = await res.json().catch(() => null);
  const text = answerText(res.status, parsed, claude ? "claude" : "openai");
  if (text === null) {
    const code = parsed && typeof parsed === "object" && typeof (parsed as { code?: unknown }).code === "number" ? (parsed as { code: number }).code : res.status;
    throw new KieError(`describe ${route.model} failed: code=${code}`, code);
  }
  return text;
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

async function main() {
  const { values: args } = parseArgs({
    options: {
      run: { type: "string", default: "r0" },
      models: { type: "string" },
      pairs: { type: "string" },
      resume: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const runDir = join(EVAL, "results", args.run!);
  const wanted = args.pairs ? args.pairs.split(",") : R0_PAIRS;
  const pairs: Pair[] = (await loadPairs(EVAL)).filter((p) => p.kind === "human" && wanted.includes(p.id));
  const routes = describeRoutes(args.models?.split(","));
  const calls = pairs.length * routes.length;
  console.log(`R0 describe: ${pairs.length} pairs (${pairs.map((p) => p.id).join(",")}) × ${routes.length} models (${routes.map((r) => r.model).join(", ")}) = ${calls} calls`);
  console.log(`estimated $${(calls * DESCRIBE_USD).toFixed(3)} (≤ $${DESCRIBE_USD} per call); outputs → ${runDir}/describe.csv, raw/*.txt`);
  if (!args.yes) {
    console.log("dry run — add --yes to execute");
    return;
  }
  if (existsSync(join(runDir, "describe.csv")) && !args.resume) throw new Error(`${runDir} already has results: pass --resume to continue, or use a new --run`);
  const key = await loadKey();
  await mkdir(join(runDir, "raw"), { recursive: true });
  const m = await meter(key);
  const uploads = new UploadCache(new KieClient(key), join(runDir, "uploads-cache.json"));
  const rows: string[] = ["pair,model,ok,survivor,infected,dropped"];
  let stopped = false;
  try {
    for (const pair of pairs) {
      for (const route of routes) {
        const rawFile = join(runDir, "raw", `${pair.id}-${route.model}.txt`);
        let raw: string | null = existsSync(rawFile) ? await readFile(rawFile, "utf8") : null;
        if (raw === null) {
          try {
            const images = [await uploads.urlFor(join(EVAL, "data", pair.survivor)), await uploads.urlFor(join(EVAL, "data", pair.infected))];
            raw = await describeOnce(key, route, images);
            await writeFile(rawFile, raw);
          } catch (e) {
            if (isQuotaError(e)) throw e;
            console.log(`✗ ${pair.id} ${route.model}: ${(e as Error).message}`);
            rows.push([pair.id, route.model, "false", "", "", ""].map(csvCell).join(","));
            continue;
          }
        }
        const look = parseAppearance(raw);
        const ok = !!(look.survivor || look.infected);
        rows.push([pair.id, route.model, ok, look.survivor, look.infected, droppedCount(raw, look)].map(csvCell).join(","));
        console.log(`${ok ? "✓" : "✗"} ${pair.id} ${route.model}`);
      }
    }
  } catch (e) {
    if (!isQuotaError(e)) throw e;
    stopped = true;
    console.error(QUOTA_MESSAGE);
  } finally {
    await writeFile(join(runDir, "describe.csv"), rows.join("\n") + "\n");
    await m.end();
  }
  if (stopped) process.exit(2);
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
