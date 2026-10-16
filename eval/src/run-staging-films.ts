// R2/R3 (christmas content spec §5): whole Christmas films on staging, one order after another.
//   node eval/src/run-staging-films.ts --run r2 --scene snow-cabin --pairs p01,p03,p06
//        [--api https://api-staging.videozombiecouple.com] [--site https://staging.videozombiecouple.com]
//        [--session-file smoke-session-staging] [--resume] [--yes]
// Same calls as apps/web/scripts/smoke.ts: upload ticket → PUT → POST /v1/stories (story
// "christmas", ordered through PREVIEW_SCENES) → preview_ready → /render → poll to done. While it
// renders, the chosen keyframes ("frames") are saved; then the film and its poster.
// Each film holds CHRISTMAS.credits of the test account. Never two at once.
// The session and the smoke key are read from ~/.vzc-secrets/ and never printed or written.
// Film cost is not measured here (staging bills its own KIE key): story ids go to story.json,
// and `node eval/src/staging-costs.ts <run>` reads stories.cost_usd from staging D1.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CHRISTMAS } from "../../packages/catalog/src/index.ts";
import { UPLOAD_CONSENT_VERSION } from "../../packages/contracts/src/stories.ts";
import { humanPairs, loadPairs, type Pair } from "./personas.ts";
import { estimateFilms, FILM_USD, QUOTA_MESSAGE, usd } from "./spend.ts";
import { costsCommand } from "./staging-costs.ts";

const EVAL = resolve(import.meta.dirname, "..");
const SECRETS = join(homedir(), ".vzc-secrets");
export const STAGING_API = "https://api-staging.videozombiecouple.com";

/** The session and smoke key go to this one origin only; anything else is refused before any read. */
export function checkApi(api: string): string {
  if (api !== STAGING_API) throw new Error(`staging only: --api must be exactly ${STAGING_API}`);
  return api;
}

/** The keyframe a signed frame link points at: …/kf-<frame>[-<n>].jpg; null when it cannot tell. */
export function frameIdOf(url: string): string | null {
  const name = new URL(url).pathname.split("/").pop() ?? "";
  const m = name.match(/^kf-([A-Za-z]+)(?:-\d+)?\.jpg$/);
  return m && CHRISTMAS.keyframes.some((k) => k.id === m[1]) ? m[1]! : null;
}

type View = {
  status: string;
  errorCode: string | null;
  progress: { done: number; total: number };
  video: { url: string; poster: string } | null;
  frames?: string[];
};

async function main() {
  const { values: args } = parseArgs({
    options: {
      run: { type: "string", default: "r2" },
      scene: { type: "string", default: "snow-cabin" },
      pairs: { type: "string", default: "p01,p03,p06" },
      api: { type: "string", default: STAGING_API },
      site: { type: "string", default: "https://staging.videozombiecouple.com" },
      "session-file": { type: "string", default: "smoke-session-staging" },
      names: { type: "string", default: "Mara & Eli" },
      resume: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
  });
  const api = checkApi(args.api!);
  const scene = args.scene!;
  if (!CHRISTMAS.scenes[scene]) throw new Error(`unknown Christmas scene ${scene}`);
  const wanted = args.pairs!.split(",");
  const pairs: Pair[] = humanPairs(await loadPairs(EVAL), wanted);
  const runDir = join(EVAL, "results", args.run!, "films", scene);
  const done = (p: Pair) => existsSync(join(runDir, p.id, "film.mp4"));
  const todo = pairs.filter((p) => !(args.resume && done(p)));

  console.log(`Staging films (${api}): scene ${scene}, pairs ${pairs.map((p) => p.id).join(",")}, one at a time`);
  console.log(`  each: 2 uploads → story "christmas" → preview → render (holds ${CHRISTMAS.credits} credits) → frames, film, poster`);
  console.log(`estimated ${usd(estimateFilms(todo.length))} (${todo.length} films × ${usd(FILM_USD)})${args.resume ? `; ${pairs.length - todo.length} already done` : ""}; outputs → ${runDir}`);
  if (!args.yes) {
    console.log("dry run — add --yes to execute");
    return;
  }
  if (estimateFilms(todo.length) > 10) throw new Error("over the $10 round budget: fewer --pairs");
  if (!args.resume && pairs.some((p) => existsSync(join(runDir, p.id)))) throw new Error(`${runDir} already has results: pass --resume, or use a new --run`);

  const session = (await readFile(join(SECRETS, args["session-file"]!), "utf8")).trim();
  const smokeKey = (await readFile(join(SECRETS, "smoke-staging"), "utf8")).trim();
  let vid = "";
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        origin: args.site!,
        "content-type": "application/json",
        cookie: [`upx_sess_stg=${session}`, ...(vid ? [`vid=${vid}`] : [])].join("; "),
        "x-smoke-key": smokeKey,
      },
    });
    vid = res.headers.get("set-cookie")?.match(/vid=([a-f0-9]{32})/)?.[1] ?? vid;
    return res;
  };
  const me = (await (await call("/v1/me")).json().catch(() => ({}))) as { credits?: number };
  const need = todo.length * CHRISTMAS.credits;
  if (typeof me.credits !== "number") throw new Error("not signed in on staging (session expired?): nothing was ordered");
  if (me.credits < need) throw new Error(`test account holds ${me.credits} credits, ${need} needed: nothing was ordered`);

  const save = async (url: string, file: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${file.split("/").pop()} failed: HTTP ${res.status}`);
    await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  };
  const upload = async (file: string) => {
    const bytes = await readFile(file);
    const ticket = await call("/v1/uploads", { method: "POST", body: JSON.stringify({ contentType: "image/jpeg", bytes: bytes.length }) });
    if (ticket.status !== 201) throw new Error(`upload ticket: HTTP ${ticket.status}`);
    const t = (await ticket.json()) as { key: string; url: string; method: string; headers: Record<string, string> };
    const put = await fetch(t.url, { method: t.method, headers: t.headers, body: new Uint8Array(bytes) });
    if (!put.ok) throw new Error(`upload: HTTP ${put.status}`);
    return t.key;
  };

  try {
    for (const pair of todo) {
      const dir = join(runDir, pair.id);
      await mkdir(join(dir, "frames"), { recursive: true });
      const logFile = join(dir, "story.json");
      const log: Record<string, unknown> = existsSync(logFile) ? JSON.parse(await readFile(logFile, "utf8")) : { pair: pair.id, scene };
      const writeLog = () => writeFile(logFile, JSON.stringify(log, null, 2));
      const t0 = Date.now();
      if (!log.storyId) {
        // A story already ordered (an interrupted run) is polled again, never ordered twice.
        const survivorKey = await upload(join(EVAL, "data", pair.survivor));
        const infectedKey = await upload(join(EVAL, "data", pair.infected));
        const created = await call("/v1/stories", {
          method: "POST",
          body: JSON.stringify({ survivorKey, infectedKey, kind: "human", story: "christmas", scene, names: args.names, idempotencyKey: `xmas-eval-${args.run}-${pair.id}-${Date.now()}`, consent: UPLOAD_CONSENT_VERSION }),
        });
        const body = (await created.json().catch(() => ({}))) as { storyId?: string; error?: { code: string } };
        if (created.status !== 201 || !body.storyId) throw new Error(`${pair.id}: story not created (${created.status} ${body.error?.code ?? ""})`);
        Object.assign(log, { storyId: body.storyId, createdAt: new Date(t0).toISOString() });
        await writeLog();
        console.log(`${pair.id}: story ${body.storyId}`);
      }
      const id = log.storyId as string;
      const seen = new Set<string>();
      let last = "";
      let rendered = !!log.renderAt;
      const end = Date.now() + 45 * 60_000;
      let view: View | null = null;
      while (Date.now() < end) {
        const res = await call(`/v1/stories/${id}`);
        if (!res.ok) throw new Error(`${pair.id}: GET /v1/stories/${id} answered HTTP ${res.status} (session expired, or the story is gone); stopping`);
        view = (await res.json()) as View;
        const line = `${view.status} ${view.progress.done}/${view.progress.total}`;
        if (line !== last) console.log(`${pair.id}:   ${line}`);
        last = line;
        if (view.status === "preview_ready" && !rendered) {
          const r = await call(`/v1/stories/${id}/render`, { method: "POST", body: JSON.stringify({ idempotencyKey: `xmas-eval-render-${id}` }) });
          if (r.status !== 202) throw new Error(`${pair.id}: render not started (${r.status})`);
          rendered = true;
          log.renderAt = new Date().toISOString();
          await writeLog();
        }
        for (const [i, url] of (view.frames ?? []).entries()) {
          const frame = frameIdOf(url) ?? `frame${i + 1}`;
          if (seen.has(frame)) continue;
          seen.add(frame);
          await save(url, join(dir, "frames", `${frame}.jpg`)).catch((e) => console.warn(`${pair.id}: ${(e as Error).message}`));
        }
        if (view.status === "done" || view.status.endsWith("failed")) break;
        await new Promise((r) => setTimeout(r, 10_000));
      }
      Object.assign(log, { status: view?.status ?? "unknown", errorCode: view?.errorCode ?? null, minutes: Number(((Date.now() - t0) / 60_000).toFixed(1)), frames: [...seen] });
      if (view?.status !== "done" || !view.video) {
        await writeLog();
        if (/LIMIT|QUOTA|433/i.test(String(view?.errorCode ?? ""))) console.error(QUOTA_MESSAGE);
        throw new Error(`${pair.id}: film not done (${view?.status ?? "timeout"} ${view?.errorCode ?? ""}); stopping before the next order`);
      }
      await save(view.video.url, join(dir, "film.mp4"));
      await save(view.video.poster, join(dir, "poster.jpg"));
      log.doneAt = new Date().toISOString();
      await writeLog();
      console.log(`${pair.id}: done in ${log.minutes} min`);
    }
  } finally {
    const ids: string[] = [];
    for (const p of pairs) {
      const f = join(runDir, p.id, "story.json");
      if (existsSync(f)) {
        const id = (JSON.parse(await readFile(f, "utf8")) as { storyId?: string }).storyId;
        if (id) ids.push(id);
      }
    }
    if (ids.length) {
      console.log(`story ids: ${ids.join(", ")}`);
      console.log(`film cost (stories.cost_usd in staging D1): node eval/src/staging-costs.ts ${args.run}`);
      console.log(`  or by hand: ${costsCommand(ids)}`);
    }
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
