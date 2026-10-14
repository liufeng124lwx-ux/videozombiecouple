// Generate one instrumental track per scene with Suno on kie (spec §4.2 S5, plan Task 9 Step 5).
//   node eval/src/run-music.ts [--scenes cabin-wheat] [--yes]
// Writes eval/results/music/<scene>-<n>.mp3 (Suno returns two takes) and music-log.json with the
// task ids, prompts and dates for assets/music/README.md. Pick one take per scene by ear, then
// convert it with ffmpeg into assets/music/<scene>.m4a.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";

const EVAL = resolve(import.meta.dirname, "..");
const OUT = join(EVAL, "results", "music");
const API = "https://api.kie.ai/api/v1";

const STYLE: Record<string, string> = {
  "cabin-wheat":
    "cinematic emotional piano and strings, slow build, tense low drone first, a single soft drum hit at 8 seconds, then warm hopeful strings, no vocals",
  "rain-chapel":
    "cinematic rain ambience into tender piano and cello, slow build, a single soft drum hit at 8 seconds, warm resolution, no vocals",
  "lighthouse-beach":
    "cinematic ocean ambience into emotional strings and piano, slow build, a single soft drum hit at 8 seconds, warm hopeful ending, no vocals",
};

const { values: args } = parseArgs({
  options: { scenes: { type: "string" }, yes: { type: "boolean", default: false } },
});

async function main() {
  const scenes = args.scenes ? args.scenes.split(",") : Object.keys(STYLE);
  console.log(`scenes=${scenes.join(",")} estimated=$${(scenes.length * 0.06).toFixed(2)}`);
  if (!args.yes) return console.log("dry run — add --yes to execute");
  const key = await loadKey();
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  await mkdir(OUT, { recursive: true });
  const log: Record<string, unknown>[] = [];
  for (const scene of scenes) {
    const style = STYLE[scene];
    if (!style) throw new Error(`unknown scene ${scene}`);
    const input = {
      custom_mode: true,
      instrumental: true,
      model: "V6",
      style,
      title: `VideoZombieCouple ${scene}`,
      negative_tags: "vocals, singing, lyrics, horror screams",
      duration: 20,
    };
    const res = await fetch(`${API}/jobs/createTask`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: "ai-music-api/generate", input }),
    });
    const created = (await res.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
    const taskId = created.data?.taskId;
    if (created.code !== 200 || !taskId) throw new Error(`createTask failed: ${created.code} ${created.msg}`);
    let tracks: { audio_url?: string; duration?: number }[] = [];
    for (let i = 0; i < 120 && tracks.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const info = (await (
        await fetch(`${API}/jobs/recordInfo?taskId=${taskId}`, { headers })
      ).json()) as { data?: { state?: string; failMsg?: string; response?: { data?: typeof tracks } } };
      if (info.data?.state === "fail") throw new Error(`${scene}: ${info.data.failMsg}`);
      if (info.data?.state === "success") tracks = info.data.response?.data ?? [];
    }
    for (const [i, t] of tracks.entries()) {
      if (!t.audio_url) continue;
      const file = join(OUT, `${scene}-${i + 1}.mp3`);
      await writeFile(file, new Uint8Array(await (await fetch(t.audio_url)).arrayBuffer()));
      console.log(`✓ ${scene} take ${i + 1} (${t.duration ?? "?"}s) → ${file}`);
    }
    log.push({ scene, taskId, model: "ai-music-api/generate (Suno V6)", input, date: new Date().toISOString() });
  }
  await writeFile(join(OUT, "music-log.json"), JSON.stringify(log, null, 2));
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
