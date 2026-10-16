// Capture the real response shapes of KIE's synchronous chat endpoints for the describe step.
//   node eval/src/probe-describe.ts          # prints the plan only
//   node eval/src/probe-describe.ts --yes [--models a,b]    # one call per model, < $0.01 in all
// Raw bodies go to eval/results/describe-probe/ (git-ignored); scrubbed copies become the
// providers test fixtures. The key is never printed; request headers are never logged.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DESCRIBE_PROMPT } from "../../packages/catalog/src/stories/appearance.ts";
import { loadKey } from "./env.ts";
import { USD_PER_CREDIT } from "./kie.ts";

const EVAL = resolve(import.meta.dirname, "..");
const ROOT = resolve(EVAL, "..");
const RAW = join(EVAL, "results", "describe-probe");
const FIXTURES = join(ROOT, "packages", "providers", "test", "fixtures");
const PHOTOS = ["p06-infected.jpg", "p03-survivor.jpg"].map((f) => join(EVAL, "data", "personas", f));
const UPLOAD_HOSTS = /https?:\/\/[^\s"']*redpandaai\.co[^\s"']*/g;

/** Deep copy of `body` with every upload URL (given, or on the upload host) replaced. */
export function scrubUrls(body: unknown, urls: string[]): unknown {
  if (typeof body === "string") {
    let s = body;
    for (const u of urls) s = s.split(u).join("<upload-url>");
    return s.replace(UPLOAD_HOSTS, "<upload-url>");
  }
  if (Array.isArray(body)) return body.map((x) => scrubUrls(x, urls));
  if (body && typeof body === "object")
    return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, scrubUrls(v, urls)]));
  return body;
}

type Style = "claude" | "openai";
/** fixture = null: raw output only (eval/results), never a committed fixture. */
type Probe = { name: string; style: Style; fixture: string | null; url: string; body: (u: string[]) => unknown };

/** The answer text when the call succeeded: HTTP 200, no error code in the body, text present. */
export function answerText(httpStatus: number, body: unknown, style: Style): string | null {
  if (httpStatus !== 200 || !body || typeof body !== "object") return null;
  const b = body as Record<string, any>;
  if ("code" in b && b.code !== 200) return null;
  const p = b.data && typeof b.data === "object" ? b.data : b;
  const text =
    style === "claude"
      ? (Array.isArray(p.content) ? p.content : [])
          .filter((x: any) => x?.type === "text" && typeof x.text === "string")
          .map((x: any) => x.text)
          .join("\n")
      : typeof p.choices?.[0]?.message?.content === "string"
        ? p.choices[0].message.content
        : "";
  return text.trim() ? text.trim() : null;
}

const openai = (model: string, fixture: string | null): Probe => ({
  name: model,
  style: "openai",
  fixture,
  url: `https://api.kie.ai/${model}/v1/chat/completions`,
  body: (u) => ({
    messages: [
      {
        role: "user",
        content: [
          ...u.map((url) => ({ type: "image_url", image_url: { url } })),
          { type: "text", text: DESCRIBE_PROMPT },
        ],
      },
    ],
    stream: false,
  }),
});

const CLAUDE: Probe = {
  name: "claude-haiku-5-5",
  style: "claude",
  fixture: "describe-claude.json",
  url: "https://api.kie.ai/claude/v1/messages",
  body: (u) => ({
    model: "claude-haiku-5-5",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: [
          ...u.map((url) => ({ type: "image", source: { type: "url", url } })),
          { type: "text", text: DESCRIBE_PROMPT },
        ],
      },
    ],
  }),
};

/** The routes' models; each writes its own fixture. */
const DEFAULT_PROBES: Probe[] = [CLAUDE, openai("gemini-3-6-flash-openai", "describe-gemini-openai.json")];
/**
 * Only with --models: gemini-3-8-flash-openai answered code 500 on 2026-10-16 (24 h success rate
 * 45%), so the route uses gemini-3-6-flash-openai (same schema and price, 84%). Raw output only.
 */
const EXTRA_PROBES: Probe[] = [openai("gemini-3-8-flash-openai", null)];

export function selectProbes(only: string[] | undefined): Probe[] {
  if (!only) return DEFAULT_PROBES;
  return [...DEFAULT_PROBES, ...EXTRA_PROBES].filter((p) => only.includes(p.name));
}

async function credits(key: string): Promise<number | null> {
  const res = await fetch("https://api.kie.ai/api/v1/chat/credit", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const j = (await res.json().catch(() => null)) as { code?: number; data?: unknown } | null;
  return j?.code === 200 && typeof j.data === "number" ? j.data : null;
}

async function main() {
  const { values } = parseArgs({
    options: { yes: { type: "boolean", default: false }, models: { type: "string" } },
  });
  const only = values.models?.split(",");
  const probes = selectProbes(only);
  if (!values.yes) {
    console.log(`Will call ${probes.length} times (${probes.map((p) => p.name).join(", ")}), estimated < $0.01. Add --yes to run.`);
    return;
  }
  const key = await loadKey();
  await mkdir(RAW, { recursive: true });
  await mkdir(FIXTURES, { recursive: true });
  const before = await credits(key);
  const urls: string[] = [];
  for (const [i, path] of PHOTOS.entries()) {
    const base64Data = `data:image/jpeg;base64,${(await readFile(path)).toString("base64")}`;
    const res = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ base64Data, uploadPath: "vzc-eval/describe", fileName: `probe-${i + 1}.jpg` }),
    });
    const j = (await res.json().catch(() => null)) as { code?: number; data?: { downloadUrl?: string } } | null;
    if (j?.code !== 200 || !j.data?.downloadUrl) throw new Error(`upload failed: code=${j?.code ?? res.status}`);
    urls.push(j.data.downloadUrl);
  }
  for (const p of probes) {
    const started = Date.now();
    const res = await fetch(p.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(p.body(urls)),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { nonJson: text.slice(0, 2000) };
    }
    await writeFile(join(RAW, `${p.name}.json`), JSON.stringify({ httpStatus: res.status, body: parsed }, null, 2));
    const ok = answerText(res.status, parsed, p.style) !== null;
    if (ok && p.fixture)
      await writeFile(join(FIXTURES, p.fixture), `${JSON.stringify(scrubUrls(parsed, urls), null, 2)}\n`);
    const kept = !p.fixture ? "raw only" : ok ? `fixture ${p.fixture} written` : "failed answer: fixture kept as it was";
    console.log(`${p.name}: HTTP ${res.status} in ${Date.now() - started} ms; ${kept}; top-level keys: ${parsed && typeof parsed === "object" ? Object.keys(parsed).join(",") : typeof parsed}`);
  }
  await writeFile(
    join(FIXTURES, "describe-error.json"),
    `${JSON.stringify({ code: 433, msg: "exceeded the daily limit", data: null }, null, 2)}\n`,
  );
  const after = await credits(key);
  if (before !== null && after !== null)
    console.log(`credits ${before} -> ${after}: spent ${(before - after).toFixed(4)} credits = $${((before - after) * USD_PER_CREDIT).toFixed(5)}`);
  else console.log("credit balance unavailable; cost not measured");
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
