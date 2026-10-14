# 模型评测工具 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 kie 上用合成人物照片跑「关键帧 → 分镜视频」两轮评测，测出每个候选模型的人脸相似度、成功率、耗时和真实成本，用来锁定模型路由和定价。

**Architecture:** `eval/` 是独立目录，不进 workspace、不进 CI。TypeScript 脚本直接用 Node 24 运行（原生去类型，零依赖），负责调 kie、断点续跑、预算拦截；Python 脚本用 `uv run`（脚本内声明依赖），负责人脸相似度打分、ffmpeg 拼接、盲评页面。所有产物写到 `eval/results/<run>/`，不提交。

**Tech Stack:** Node ≥ 24（`node:test`、原生 TS）、kie API（`api.kie.ai` + `kieai.redpandaai.co` 上传）、Python 3.12 + uv、insightface（buffalo_l）、OpenCV、ffmpeg。

**Spec:** `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md`（§5 分镜与提示词、§10 评测）

## Global Constraints

- Node ≥ 24；`eval/` 的 TS 不引入任何 npm 依赖，不写构造函数参数属性（`constructor(private x)`）和 `enum`——Node 原生去类型不支持。
- KIE 密钥只从环境变量 `KIE_API_KEY` 或 `~/.vzc-secrets/eval.env` 读取；绝不打印、写日志或提交。
- 每轮评测预算 ≤ $10（脚本 `--budget` 默认 10，预估超预算直接拒绝执行）；kie 子 key 日限额 $15、总额 $40。
- 不带 `--yes` 只打印计划和预估费用；真正花钱前先把预估给用户看并得到同意。
- 评测照片只用 AI 合成人物（本计划 Task 4 生成）；真实照片若有，只放 `eval/data/real/`（gitignore）并去 EXIF。
- 输出统一 9:16；镜头不足模型最短时长时向上取到最短值，拼接时再剪到目标时长。
- 视频镜头一律 `generate_audio:false` / `sound:false`（配乐在后期统一加）。
- 提示词负面约束固定：no blood, no gore, no biting, no gunfire, no text。

## Review Focus

1. **kie 返回 HTTP 200 但 body `code` 为 401 / 402 / 433（key 错、余额不足、子 key 超限）**：该任务记失败，整轮立即停止，不再继续发任务。→ Task 2、Task 3 测试。
2. **结果文件下载失败（链接过期或 5xx）**：任务记失败，但 kie 已扣的费用照样计入花费，预算拦截才可信。→ Task 3 测试。
3. **视频任务卡在 `generating` 超过超时**：记失败，花费按预估计入（钱可能已扣），不无限轮询。→ Task 3 测试。
4. **脚本中途崩溃后重跑**：已成功的任务跳过，失败的任务重试，不重复花钱。→ Task 3（runner）测试。
5. **生成图里检测不到人脸（丧尸妆太重、背影）**：打分记 `null`、排在最后，不让脚本崩溃。→ Task 8 的 `score_image` 处理与自检步骤。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `.gitignore` | 忽略评测数据与产物 |
| `eval/README.md` | 怎么跑、怎么判定 |
| `eval/src/env.ts` | 读取 KIE key |
| `eval/src/kie.ts` | kie 客户端：上传、建任务、轮询、下载；`KieError`；`UploadCache` |
| `eval/src/runner.ts` | 通用的断点续跑 + 预算拦截 + 并发执行器；`JobFailed` |
| `eval/src/kie-job.ts` | 把一次 kie 调用包装成 runner 的 Job（计费、下载、错误归类） |
| `eval/src/storyboard.ts` | 关键帧与镜头定义、提示词组装（人 / 宠物） |
| `eval/src/candidates.ts` | 图像与视频候选模型的入参映射与预估价格 |
| `eval/src/personas.ts` | 合成人物描述与配对清单 |
| `eval/src/run-personas.ts` | CLI：生成合成人物照片 + `pairs.json` |
| `eval/src/run-keyframes.ts` | CLI：生成关键帧 A / C（阶段 AC）或 B（阶段 B） |
| `eval/src/run-shots.ts` | CLI：生成 4 个镜头 |
| `eval/scripts/face_score.py` | 人脸相似度打分，产出 `scores.json` 与 `picks.json` |
| `eval/scripts/stitch.py` | 按目标时长剪切并拼接镜头 |
| `eval/scripts/report.py` | 汇总表 + 盲评页面 `review.html` |
| `eval/test/*.test.ts` | 单元测试 |
| `docs/model-eval.md` | 评测结论（Task 11 写） |

运行目录约定：`eval/results/<run>/kf/results.jsonl`、`kf/<model>/<pair>/<frame>-<n>.jpg`、`shots/results.jsonl`、`shots/<model>/<pair>/shot<id>.mp4`、`scores.json`、`picks.json`、`stitched/<model>/<pair>.mp4`、`review.html`、`blind-key.json`。

---

### Task 1: 评测目录骨架与 key 读取

**Files:**
- Create: `.gitignore`
- Create: `eval/README.md`
- Create: `eval/src/env.ts`
- Test: `eval/test/env.test.ts`

**Interfaces:**
- Produces: `parseKey(text: string): string | null`、`loadKey(): Promise<string>`、`SECRETS_FILE: string`

- [ ] **Step 1: 写 `.gitignore`**

```gitignore
node_modules/
.DS_Store
.env*
!.env.example
# eval: photos and model outputs stay local
eval/data/real/
eval/data/personas/
eval/results/
```

- [ ] **Step 2: 写失败的测试 `eval/test/env.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKey } from "../src/env.ts";

test("parseKey reads KIE_API_KEY line and trims it", () => {
  assert.equal(parseKey("FOO=1\nKIE_API_KEY= abc123 \n"), "abc123");
});

test("parseKey returns null when the line is missing", () => {
  assert.equal(parseKey("FOO=1\n"), null);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test eval/test/env.test.ts`
Expected: FAIL，报错找不到模块 `../src/env.ts`

- [ ] **Step 4: 写 `eval/src/env.ts`**

```ts
// KIE key for the eval harness: env var first, then ~/.vzc-secrets/eval.env. Never print it.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SECRETS_FILE = join(homedir(), ".vzc-secrets", "eval.env");

export function parseKey(text: string): string | null {
  const m = text.match(/^KIE_API_KEY=(.+)$/m);
  return m ? m[1].trim() : null;
}

export async function loadKey(): Promise<string> {
  if (process.env.KIE_API_KEY) return process.env.KIE_API_KEY;
  if (existsSync(SECRETS_FILE)) {
    const key = parseKey(await readFile(SECRETS_FILE, "utf8"));
    if (key) return key;
  }
  throw new Error(`KIE_API_KEY not found (env or ${SECRETS_FILE})`);
}
```

- [ ] **Step 5: 运行确认通过**

Run: `node --test eval/test/env.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 6: 写 `eval/README.md`**

````markdown
# 模型评测

目标：选出关键帧（图像编辑）和分镜（图生视频）的默认模型与备用模型，测出单次预览成本和单条视频成本。设计见 `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md` §10。

## 准备
- key：`~/.vzc-secrets/eval.env` 里写 `KIE_API_KEY=...`（不进仓库、不打印）。
- 工具：Node ≥ 24、`uv`、`ffmpeg`（`brew install uv ffmpeg`）。
- 测试：`node --test eval/test/`

## 一轮完整流程
```bash
node eval/src/run-personas.ts --yes                                   # 合成人物照片（约 $0.6，只需一次）
node eval/src/run-keyframes.ts --run r1 --stage AC                    # 看计划和预估
node eval/src/run-keyframes.ts --run r1 --stage AC --yes              # 执行
uv run eval/scripts/face_score.py eval/results/r1                     # 打分 + 挑每组最佳
node eval/src/run-keyframes.ts --run r1 --stage B --models nb2 --yes  # 用最佳 A/C 生成 B
uv run eval/scripts/face_score.py eval/results/r1
node eval/src/run-shots.ts --run r1 --kf-model nb2 --pairs p01,p07 --yes
uv run eval/scripts/face_score.py eval/results/r1
uv run eval/scripts/stitch.py eval/results/r1
uv run eval/scripts/report.py eval/results/r1                         # 打开 review.html 盲评
```

## 怎么判定
1. 盲评为主：每个关键帧 / 成片打 1–5 分（像不像本人、情绪、转场），导出 `ratings.json`。
2. 人脸相似度为辅（insightface 余弦相似度，越高越像）。
3. 一票否决：两张脸混合、性别或肤色被改、出现血腥画面的比例超过 10%。
4. 记录成功率、p50 / p90 耗时、实际花费（kie 返回的 `creditsConsumed`，1 积分 = $0.005）。

结论写进 `docs/model-eval.md`。
````

- [ ] **Step 7: Commit**

```bash
git add .gitignore eval/README.md eval/src/env.ts eval/test/env.test.ts
git commit -m "chore(eval): scaffold eval harness and key loading"
```

---

### Task 2: kie 客户端

**Files:**
- Create: `eval/src/kie.ts`
- Test: `eval/test/kie.test.ts`

**Interfaces:**
- Produces:
  - `USD_PER_CREDIT = 0.005`
  - `class KieError extends Error { code: number | null; fatal: boolean }`（401 / 402 / 433 为 fatal）
  - `type TaskResult = { state: "success" | "fail"; urls: string[]; creditsConsumed: number | null; costTimeSec: number | null; failMsg?: string }`
  - `parseRecord(d: any): TaskResult | null`（非终态返回 null）
  - `class KieClient { constructor(key: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>); upload(bytes: Uint8Array, mime: string, fileName: string): Promise<string>; createTask(model: string, input: Record<string, unknown>): Promise<string>; wait(taskId: string, timeoutMs: number): Promise<TaskResult>; download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> }`
  - `class UploadCache { constructor(kie: { upload: KieClient["upload"] }, cacheFile: string, now?: () => number); urlFor(path: string): Promise<string> }`

- [ ] **Step 1: 写失败的测试 `eval/test/kie.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KieClient, KieError, UploadCache, parseRecord } from "../src/kie.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses.shift();
    if (!r) throw new Error("no more fake responses");
    return r;
  }) as typeof fetch;
  return { impl, calls };
}
const noSleep = async () => {};

test("createTask returns taskId and sends model + input", async () => {
  const f = fakeFetch([json({ code: 200, data: { taskId: "t1" } })]);
  const kie = new KieClient("k", f.impl, noSleep);
  assert.equal(await kie.createTask("m", { prompt: "x" }), "t1");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { model: "m", input: { prompt: "x" } });
});

test("createTask: HTTP 200 with body code 402 throws a fatal KieError", async () => {
  const f = fakeFetch([json({ code: 402, msg: "insufficient balance" })]);
  const kie = new KieClient("k", f.impl, noSleep);
  await assert.rejects(kie.createTask("m", {}), (e: unknown) => e instanceof KieError && e.code === 402 && e.fatal);
});

test("createTask: body code 422 is not fatal", async () => {
  const f = fakeFetch([json({ code: 422, msg: "bad input" })]);
  const kie = new KieClient("k", f.impl, noSleep);
  await assert.rejects(kie.createTask("m", {}), (e: unknown) => e instanceof KieError && !e.fatal);
});

test("parseRecord prefers response.resultUrls and returns null while running", () => {
  assert.equal(parseRecord({ state: "generating" }), null);
  const r = parseRecord({
    state: "success",
    response: { resultUrls: ["https://a/1.mp4"] },
    resultJson: "{\"resultUrls\":[\"https://b/2.mp4\"]}",
    creditsConsumed: 40,
    costTime: 61,
  });
  assert.deepEqual(r, { state: "success", urls: ["https://a/1.mp4"], creditsConsumed: 40, costTimeSec: 61, failMsg: undefined });
});

test("parseRecord falls back to resultJson and reports failMsg", () => {
  assert.deepEqual(parseRecord({ state: "success", resultJson: "{\"resultUrls\":[\"u\"]}" })?.urls, ["u"]);
  assert.equal(parseRecord({ state: "fail", failMsg: "nsfw" })?.failMsg, "nsfw");
});

test("wait polls until terminal state", async () => {
  const f = fakeFetch([
    json({ code: 200, data: { state: "queuing" } }),
    json({ code: 200, data: { state: "success", response: { resultUrls: ["u"] }, creditsConsumed: 3 } }),
  ]);
  const kie = new KieClient("k", f.impl, noSleep);
  const r = await kie.wait("t1", 60_000);
  assert.equal(r.state, "success");
  assert.equal(f.calls.length, 2);
});

test("wait times out instead of polling forever", async () => {
  const responses = Array.from({ length: 50 }, () => json({ code: 200, data: { state: "generating" } }));
  const f = fakeFetch(responses);
  let now = 0;
  const kie = new KieClient("k", f.impl, async (ms) => {
    now += ms;
  });
  const realNow = Date.now;
  Date.now = () => now;
  try {
    await assert.rejects(kie.wait("t1", 30_000), /timed out/);
  } finally {
    Date.now = realNow;
  }
});

test("UploadCache uploads once and reuses the url within 20h", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vzc-"));
  const file = join(dir, "a.jpg");
  await writeFile(file, "jpegbytes");
  let uploads = 0;
  let clock = 1_000;
  const cache = new UploadCache({ upload: async () => `https://u/${++uploads}` }, join(dir, "cache.json"), () => clock);
  assert.equal(await cache.urlFor(file), "https://u/1");
  clock += 19 * 3600_000;
  assert.equal(await cache.urlFor(file), "https://u/1");
  clock += 2 * 3600_000;
  assert.equal(await cache.urlFor(file), "https://u/2");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test eval/test/kie.test.ts`
Expected: FAIL，找不到模块 `../src/kie.ts`

- [ ] **Step 3: 写 `eval/src/kie.ts`**

```ts
// Minimal kie.ai client for the eval harness (Node >= 24, native TS, no deps).
// kie answers HTTP 200 even on errors: always check the body `code`.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname } from "node:path";

const API = "https://api.kie.ai/api/v1";
const UPLOAD = "https://kieai.redpandaai.co/api";
export const USD_PER_CREDIT = 0.005;
// 401 bad key, 402 balance, 433 sub-key limit: continuing the run cannot succeed.
const FATAL_CODES = new Set([401, 402, 433]);

export class KieError extends Error {
  code: number | null;
  fatal: boolean;
  constructor(message: string, code: number | null) {
    super(message);
    this.code = code;
    this.fatal = code !== null && FATAL_CODES.has(code);
  }
}

export type TaskResult = {
  state: "success" | "fail";
  urls: string[];
  creditsConsumed: number | null;
  costTimeSec: number | null;
  failMsg?: string;
};

export function parseRecord(d: any): TaskResult | null {
  if (d?.state !== "success" && d?.state !== "fail") return null;
  let urls: string[] = Array.isArray(d.response?.resultUrls) ? d.response.resultUrls : [];
  if (!urls.length) {
    try {
      urls = JSON.parse(d.resultJson ?? "{}").resultUrls ?? [];
    } catch {
      urls = [];
    }
  }
  return {
    state: d.state,
    urls,
    creditsConsumed: typeof d.creditsConsumed === "number" ? d.creditsConsumed : null,
    costTimeSec: typeof d.costTime === "number" ? d.costTime : null,
    failMsg: d.failMsg || d.failCode || undefined,
  };
}

export class KieClient {
  key: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;

  constructor(key: string, fetchImpl: typeof fetch = fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.key = key;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  private headers() {
    return { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" };
  }

  private async body(res: Response, what: string): Promise<any> {
    const j: any = await res.json().catch(() => ({}));
    if (j?.code !== 200) {
      const code = typeof j?.code === "number" ? j.code : null;
      throw new KieError(`${what} failed: code=${code ?? res.status} ${j?.msg ?? ""}`.trim(), code);
    }
    return j;
  }

  /** Upload bytes to kie's temp storage (kept ~24h); returns a URL usable as model input. */
  async upload(bytes: Uint8Array, mime: string, fileName: string): Promise<string> {
    const base64Data = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    const res = await this.fetchImpl(`${UPLOAD}/file-base64-upload`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ base64Data, uploadPath: "vzc-eval", fileName }),
    });
    const j = await this.body(res, "upload");
    const url = j?.data?.downloadUrl;
    if (!url) throw new KieError("upload failed: no downloadUrl", null);
    return url;
  }

  async createTask(model: string, input: Record<string, unknown>): Promise<string> {
    const res = await this.fetchImpl(`${API}/jobs/createTask`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ model, input }),
    });
    const j = await this.body(res, `createTask ${model}`);
    if (!j?.data?.taskId) throw new KieError(`createTask ${model} failed: no taskId`, null);
    return j.data.taskId;
  }

  async wait(taskId: string, timeoutMs: number): Promise<TaskResult> {
    const started = Date.now();
    let delay = 3000;
    while (Date.now() - started < timeoutMs) {
      await this.sleep(delay);
      delay = Math.min(delay * 1.4, 10_000);
      const res = await this.fetchImpl(`${API}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: this.headers() });
      const j: any = await res.json().catch(() => ({}));
      if (j?.code !== 200) {
        const code = typeof j?.code === "number" ? j.code : null;
        if (code !== null && FATAL_CODES.has(code)) throw new KieError(`recordInfo failed: code=${code}`, code);
        continue; // transient: keep polling
      }
      const r = parseRecord(j.data);
      if (r) return r;
    }
    throw new Error(`task ${taskId} timed out after ${Math.round(timeoutMs / 1000)}s`);
  }

  async download(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "" };
  }
}

const MIME: Record<string, string> = { ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Upload each local file at most once per 20h (kie keeps uploads ~24h). */
export class UploadCache {
  kie: { upload: KieClient["upload"] };
  cacheFile: string;
  now: () => number;
  private cache: Record<string, { url: string; at: number }> | null = null;

  constructor(kie: { upload: KieClient["upload"] }, cacheFile: string, now: () => number = Date.now) {
    this.kie = kie;
    this.cacheFile = cacheFile;
    this.now = now;
  }

  async urlFor(path: string): Promise<string> {
    if (!this.cache) this.cache = existsSync(this.cacheFile) ? JSON.parse(await readFile(this.cacheFile, "utf8")) : {};
    const cache = this.cache!;
    const hit = cache[path];
    if (hit && this.now() - hit.at < 20 * 3600_000) return hit.url;
    const ext = extname(path).toLowerCase();
    const name = createHash("sha1").update(path).digest("hex").slice(0, 12) + ext;
    const url = await this.kie.upload(new Uint8Array(await readFile(path)), MIME[ext] ?? "image/jpeg", name);
    cache[path] = { url, at: this.now() };
    await writeFile(this.cacheFile, JSON.stringify(cache, null, 1));
    return url;
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test eval/test/kie.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add eval/src/kie.ts eval/test/kie.test.ts
git commit -m "feat(eval): kie client with body-code errors, polling timeout and upload cache"
```

---

### Task 3: 断点续跑的执行器与 kie 任务包装

**Files:**
- Create: `eval/src/runner.ts`
- Create: `eval/src/kie-job.ts`
- Test: `eval/test/runner.test.ts`
- Test: `eval/test/kie-job.test.ts`

**Interfaces:**
- Consumes: `KieClient`、`KieError`、`USD_PER_CREDIT`（Task 2）
- Produces:
  - `type JobOutcome = { costUsd: number; outputs: string[]; meta?: Record<string, unknown> }`
  - `type Job = { key: string; estUsd: number; meta: Record<string, unknown>; run: () => Promise<JobOutcome> }`
  - `class JobFailed extends Error { costUsd: number; fatal: boolean }`
  - `type RunSummary = { planned: number; skipped: number; estUsd: number; spentUsd: number; succeeded: number; failed: number; aborted: string | null }`
  - `readRows(resultsFile: string): Promise<Record<string, any>[]>`
  - `runJobs(o: { resultsFile: string; jobs: Job[]; budgetUsd: number; concurrency: number; execute: boolean; log?: (s: string) => void }): Promise<RunSummary>`
  - `runKieTask(o: { kie: Pick<KieClient, "createTask" | "wait" | "download">; model: string; input: Record<string, unknown>; estUsd: number; timeoutMs: number; save: (bytes: Uint8Array, contentType: string, index: number) => Promise<string> }): Promise<JobOutcome>`

结果行格式（`results.jsonl` 每行）：`{ key, status: "succeeded" | "failed", costUsd, latencyMs, outputs?, error?, meta, at }`，`meta` 原样来自 Job。

- [ ] **Step 1: 写失败的测试 `eval/test/runner.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobFailed, readRows, runJobs, type Job } from "../src/runner.ts";

const tmp = async () => join(await mkdtemp(join(tmpdir(), "vzc-run-")), "results.jsonl");
const ok = (key: string, cost = 1): Job => ({ key, estUsd: cost, meta: { key }, run: async () => ({ costUsd: cost, outputs: [`${key}.jpg`] }) });

test("dry run plans and spends nothing", async () => {
  const file = await tmp();
  let ran = 0;
  const jobs = [ok("a"), { ...ok("b"), run: async () => (ran++, { costUsd: 1, outputs: [] }) }];
  const s = await runJobs({ resultsFile: file, jobs, budgetUsd: 10, concurrency: 2, execute: false });
  assert.equal(s.planned, 2);
  assert.equal(s.estUsd, 2);
  assert.equal(ran, 0);
});

test("estimate over budget refuses to run", async () => {
  const file = await tmp();
  await assert.rejects(runJobs({ resultsFile: file, jobs: [ok("a", 6), ok("b", 6)], budgetUsd: 10, concurrency: 1, execute: true }), /exceeds budget/);
});

test("rerun skips succeeded jobs and retries failed ones", async () => {
  const file = await tmp();
  let attempts = 0;
  const flaky: Job = { key: "f", estUsd: 1, meta: {}, run: async () => { attempts++; if (attempts === 1) throw new Error("boom"); return { costUsd: 1, outputs: [] }; } };
  await runJobs({ resultsFile: file, jobs: [ok("a"), flaky], budgetUsd: 10, concurrency: 1, execute: true });
  const s2 = await runJobs({ resultsFile: file, jobs: [ok("a"), flaky], budgetUsd: 10, concurrency: 1, execute: true });
  assert.equal(s2.skipped, 1);
  assert.equal(s2.succeeded, 1);
  assert.equal(attempts, 2);
});

test("spending stops once the budget is reached", async () => {
  const file = await tmp();
  // estimates are low, real costs are high: the guard must use real spend
  const jobs = ["a", "b", "c", "d"].map((k) => ({ ...ok(k, 1), run: async () => ({ costUsd: 4, outputs: [] }) }));
  const s = await runJobs({ resultsFile: file, jobs, budgetUsd: 10, concurrency: 1, execute: true });
  assert.equal(s.succeeded, 3);
  assert.equal(s.aborted, "budget");
});

test("a fatal failure aborts the run and records its cost", async () => {
  const file = await tmp();
  const fatal: Job = { key: "x", estUsd: 1, meta: { m: 1 }, run: async () => { throw new JobFailed("code=402", 0, true); } };
  const s = await runJobs({ resultsFile: file, jobs: [fatal, ok("b")], budgetUsd: 10, concurrency: 1, execute: true });
  assert.match(s.aborted ?? "", /402/);
  const rows = await readRows(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "failed");
  assert.deepEqual(rows[0].meta, { m: 1 });
});
```

- [ ] **Step 2: 写失败的测试 `eval/test/kie-job.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { KieError } from "../src/kie.ts";
import { JobFailed } from "../src/runner.ts";
import { runKieTask } from "../src/kie-job.ts";

const base = { model: "m", input: {}, estUsd: 0.5, timeoutMs: 1000 };
const save = async (_b: Uint8Array, _ct: string, i: number) => `out-${i}.mp4`;

test("success: cost from creditsConsumed, outputs saved", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "success" as const, urls: ["u"], creditsConsumed: 40, costTimeSec: 60 }),
    download: async () => ({ bytes: new Uint8Array([1]), contentType: "video/mp4" }),
  };
  const r = await runKieTask({ ...base, kie, save });
  assert.equal(r.costUsd, 0.2);
  assert.deepEqual(r.outputs, ["out-0.mp4"]);
  assert.equal(r.meta?.costTimeSec, 60);
});

test("createTask fatal KieError becomes fatal JobFailed with zero cost", async () => {
  const kie = { createTask: async () => { throw new KieError("code=433", 433); }, wait: async () => { throw new Error("unreachable"); }, download: async () => { throw new Error("unreachable"); } };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.fatal && e.costUsd === 0);
});

test("download failure still records the money kie charged", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "success" as const, urls: ["u"], creditsConsumed: 40, costTimeSec: 1 }),
    download: async () => { throw new Error("download failed: HTTP 404"); },
  };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.costUsd === 0.2 && !e.fatal);
});

test("timeout counts the estimate as spent", async () => {
  const kie = { createTask: async () => "t", wait: async () => { throw new Error("task t timed out after 1s"); }, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && e.costUsd === 0.5);
});

test("model-side failure carries failMsg and charged cost", async () => {
  const kie = {
    createTask: async () => "t",
    wait: async () => ({ state: "fail" as const, urls: [], creditsConsumed: 0, costTimeSec: 1, failMsg: "content rejected" }),
    download: async () => ({ bytes: new Uint8Array(), contentType: "" }),
  };
  await assert.rejects(runKieTask({ ...base, kie, save }), (e: unknown) => e instanceof JobFailed && /content rejected/.test(e.message) && e.costUsd === 0);
});
```

- [ ] **Step 3: 运行确认失败**

Run: `node --test eval/test/runner.test.ts eval/test/kie-job.test.ts`
Expected: FAIL，找不到模块 `../src/runner.ts`、`../src/kie-job.ts`

- [ ] **Step 4: 写 `eval/src/runner.ts`**

```ts
// Resumable, budget-guarded job runner. Results append to <run>/<stage>/results.jsonl.
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

export type JobOutcome = { costUsd: number; outputs: string[]; meta?: Record<string, unknown> };
export type Job = { key: string; estUsd: number; meta: Record<string, unknown>; run: () => Promise<JobOutcome> };
export type RunSummary = { planned: number; skipped: number; estUsd: number; spentUsd: number; succeeded: number; failed: number; aborted: string | null };

export class JobFailed extends Error {
  costUsd: number;
  fatal: boolean;
  constructor(message: string, costUsd: number, fatal = false) {
    super(message);
    this.costUsd = costUsd;
    this.fatal = fatal;
  }
}

export async function readRows(resultsFile: string): Promise<Record<string, any>[]> {
  if (!existsSync(resultsFile)) return [];
  return (await readFile(resultsFile, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

export async function runJobs(o: {
  resultsFile: string;
  jobs: Job[];
  budgetUsd: number;
  concurrency: number;
  execute: boolean;
  log?: (s: string) => void;
}): Promise<RunSummary> {
  const log = o.log ?? console.log;
  const done = new Set((await readRows(o.resultsFile)).filter((r) => r.status === "succeeded").map((r) => r.key));
  const todo = o.jobs.filter((j) => !done.has(j.key));
  const estUsd = todo.reduce((s, j) => s + j.estUsd, 0);
  const s: RunSummary = { planned: todo.length, skipped: o.jobs.length - todo.length, estUsd, spentUsd: 0, succeeded: 0, failed: 0, aborted: null };
  log(`jobs=${todo.length} (skipping ${s.skipped} done) estimated=$${estUsd.toFixed(2)} budget=$${o.budgetUsd}`);
  if (estUsd > o.budgetUsd) throw new Error(`estimated cost $${estUsd.toFixed(2)} exceeds budget $${o.budgetUsd}; narrow --models/--pairs`);
  if (!o.execute) {
    log("dry run — add --yes to execute");
    return s;
  }
  await mkdir(dirname(o.resultsFile), { recursive: true });

  let next = 0;
  const worker = async () => {
    while (next < todo.length && !s.aborted) {
      if (s.spentUsd >= o.budgetUsd) {
        s.aborted ??= "budget";
        return;
      }
      const job = todo[next++];
      const t0 = Date.now();
      const row: Record<string, unknown> = { key: job.key, meta: job.meta };
      try {
        const out = await job.run();
        s.spentUsd += out.costUsd;
        s.succeeded++;
        Object.assign(row, { status: "succeeded", costUsd: out.costUsd, outputs: out.outputs, meta: { ...job.meta, ...out.meta } });
      } catch (e) {
        const cost = e instanceof JobFailed ? e.costUsd : 0;
        s.spentUsd += cost;
        s.failed++;
        Object.assign(row, { status: "failed", costUsd: cost, error: String((e as Error).message ?? e) });
        if (e instanceof JobFailed && e.fatal) s.aborted = String(row.error);
      }
      row.latencyMs = Date.now() - t0;
      row.at = new Date().toISOString();
      await appendFile(o.resultsFile, JSON.stringify(row) + "\n");
      log(`${row.status === "succeeded" ? "✓" : "✗"} ${job.key} $${Number(row.costUsd).toFixed(3)} ${((row.latencyMs as number) / 1000).toFixed(0)}s${row.error ? " " + row.error : ""} (spent $${s.spentUsd.toFixed(2)})`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  log(`done: ${s.succeeded} ok, ${s.failed} failed, spent ≈ $${s.spentUsd.toFixed(2)}${s.aborted ? `, aborted: ${s.aborted}` : ""}`);
  return s;
}
```

- [ ] **Step 5: 写 `eval/src/kie-job.ts`**

```ts
// Wrap one kie createTask → wait → download into a runner JobOutcome, classifying failures.
import { KieError, USD_PER_CREDIT, type KieClient } from "./kie.ts";
import { JobFailed, type JobOutcome } from "./runner.ts";

export async function runKieTask(o: {
  kie: Pick<KieClient, "createTask" | "wait" | "download">;
  model: string;
  input: Record<string, unknown>;
  estUsd: number;
  timeoutMs: number;
  save: (bytes: Uint8Array, contentType: string, index: number) => Promise<string>;
}): Promise<JobOutcome> {
  let taskId: string;
  try {
    taskId = await o.kie.createTask(o.model, o.input);
  } catch (e) {
    throw new JobFailed(String((e as Error).message), 0, e instanceof KieError && e.fatal);
  }
  let r;
  try {
    r = await o.kie.wait(taskId, o.timeoutMs);
  } catch (e) {
    // The task may still be billed: count the estimate so the budget guard stays honest.
    const fatal = e instanceof KieError && e.fatal;
    throw new JobFailed(`${taskId}: ${(e as Error).message}`, fatal ? 0 : o.estUsd, fatal);
  }
  const costUsd = r.creditsConsumed != null ? r.creditsConsumed * USD_PER_CREDIT : o.estUsd;
  if (r.state !== "success" || !r.urls.length) throw new JobFailed(`${taskId}: ${r.failMsg ?? "no output url"}`, costUsd);
  const outputs: string[] = [];
  try {
    for (const [i, url] of r.urls.entries()) {
      const d = await o.kie.download(url);
      outputs.push(await o.save(d.bytes, d.contentType, i));
    }
  } catch (e) {
    throw new JobFailed(`${taskId}: ${(e as Error).message}`, costUsd);
  }
  return { costUsd, outputs, meta: { taskId, costTimeSec: r.costTimeSec } };
}
```

- [ ] **Step 6: 运行确认通过**

Run: `node --test eval/test/runner.test.ts eval/test/kie-job.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 7: Commit**

```bash
git add eval/src/runner.ts eval/src/kie-job.ts eval/test/runner.test.ts eval/test/kie-job.test.ts
git commit -m "feat(eval): resumable budget-guarded runner and kie task wrapper"
```

---

### Task 4: 合成人物与配对清单

**Files:**
- Create: `eval/src/personas.ts`
- Create: `eval/src/run-personas.ts`
- Test: `eval/test/personas.test.ts`

**Interfaces:**
- Consumes: `loadKey`（Task 1）、`KieClient`（Task 2）、`runJobs`、`runKieTask`（Task 3）
- Produces:
  - `type Kind = "human" | "pet"`
  - `type Pair = { id: string; kind: Kind; survivor: string; infected: string }`（路径相对 `eval/data/`）
  - `PAIRS_FILE = "eval/data/pairs.json"`（运行时用绝对路径 `join(EVAL, "data", "pairs.json")`）
  - `PERSONAS: { id: string; kind: Kind; survivor: string; infected: string }[]`（描述文字）
  - `portraitPrompt(desc: string, isAnimal: boolean): string`
  - `loadPairs(evalDir: string): Promise<Pair[]>`

人物覆盖：不同肤色、发型、年龄、光头、头巾、同性情侣；`q01`、`q02` 是宠物组（二期才评，但照片一次生成好）。

- [ ] **Step 1: 写失败的测试 `eval/test/personas.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PERSONAS, portraitPrompt } from "../src/personas.ts";

test("10 human pairs and 2 pet pairs with unique ids", () => {
  assert.equal(PERSONAS.filter((p) => p.kind === "human").length, 10);
  assert.equal(PERSONAS.filter((p) => p.kind === "pet").length, 2);
  assert.equal(new Set(PERSONAS.map((p) => p.id)).size, PERSONAS.length);
});

test("portrait prompt asks for a single front-facing subject", () => {
  const p = portraitPrompt("woman in her 30s", false);
  assert.match(p, /woman in her 30s/);
  assert.match(p, /single person/);
  assert.match(portraitPrompt("orange tabby cat", true), /single animal/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test eval/test/personas.test.ts`
Expected: FAIL，找不到模块 `../src/personas.ts`

- [ ] **Step 3: 写 `eval/src/personas.ts`**

```ts
// Synthetic eval subjects: AI-generated people (no real photos), diverse on purpose.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Kind = "human" | "pet";
export type Pair = { id: string; kind: Kind; survivor: string; infected: string };

export const PERSONAS: { id: string; kind: Kind; survivor: string; infected: string }[] = [
  { id: "p01", kind: "human", survivor: "East Asian man in his late 20s, short black hair", infected: "East Asian woman in her late 20s, shoulder-length black hair" },
  { id: "p02", kind: "human", survivor: "Black woman in her 30s, natural curly hair", infected: "Black man in his 30s, short fade haircut and a beard" },
  { id: "p03", kind: "human", survivor: "white man in his 20s, messy blond hair", infected: "white woman in her 20s, long red hair" },
  { id: "p04", kind: "human", survivor: "South Asian woman in her 30s, long dark braid", infected: "South Asian man in his 30s, glasses and short hair" },
  { id: "p05", kind: "human", survivor: "Latina woman in her 20s, wavy brown hair", infected: "Latino man in his 20s, buzz cut" },
  { id: "p06", kind: "human", survivor: "Middle Eastern man in his 40s, salt-and-pepper beard", infected: "Middle Eastern woman in her 40s wearing a hijab" },
  { id: "p07", kind: "human", survivor: "white woman in her 50s, short grey bob", infected: "white man in his 50s, completely bald" },
  { id: "p08", kind: "human", survivor: "Black man in his 20s, long locs", infected: "East Asian woman in her 20s, pink dyed bob" },
  { id: "p09", kind: "human", survivor: "white woman in her 30s with freckles and a ponytail", infected: "white woman in her 30s with a short pixie cut" },
  { id: "p10", kind: "human", survivor: "Southeast Asian man in his 30s, undercut hairstyle", infected: "Southeast Asian man in his 30s, curly hair" },
  { id: "q01", kind: "pet", survivor: "white woman in her 30s, long brown hair", infected: "orange tabby cat" },
  { id: "q02", kind: "pet", survivor: "Black man in his 30s, short hair", infected: "golden retriever dog" },
];

export function portraitPrompt(desc: string, isAnimal: boolean): string {
  return isAnimal
    ? `Photorealistic smartphone photo of a ${desc}, facing the camera, head and shoulders, neutral indoor background, natural light, single animal, no text.`
    : `Photorealistic smartphone portrait photo of a ${desc}, facing the camera, head and shoulders, neutral indoor background, natural light, single person, no text.`;
}

export async function loadPairs(evalDir: string): Promise<Pair[]> {
  return JSON.parse(await readFile(join(evalDir, "data", "pairs.json"), "utf8"));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test eval/test/personas.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: 写 `eval/src/run-personas.ts`**

```ts
// Generate the synthetic subject photos once and write eval/data/pairs.json.
//   node eval/src/run-personas.ts [--budget 2] [--yes]
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { PERSONAS, portraitPrompt, type Pair } from "./personas.ts";

const EVAL = resolve(import.meta.dirname, "..");
const OUT = join(EVAL, "data", "personas");
const MODEL = "nano-banana-2";
const EST = 0.025;

const { values: args } = parseArgs({ options: { budget: { type: "string", default: "2" }, yes: { type: "boolean", default: false } } });

async function main() {
  await mkdir(OUT, { recursive: true });
  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const jobs: Job[] = PERSONAS.flatMap((p) =>
    (["survivor", "infected"] as const).map((role) => {
      const isAnimal = p.kind === "pet" && role === "infected";
      const file = join(OUT, `${p.id}-${role}.jpg`);
      return {
        key: `${p.id}-${role}`,
        estUsd: EST,
        meta: { pair: p.id, role },
        run: () =>
          runKieTask({
            kie,
            model: MODEL,
            input: { prompt: portraitPrompt(p[role], isAnimal), aspect_ratio: "3:4", resolution: "1K", output_format: "jpg" },
            estUsd: EST,
            timeoutMs: 5 * 60_000,
            save: async (bytes) => (await writeFile(file, bytes), file),
          }),
      };
    }),
  );
  const s = await runJobs({ resultsFile: join(OUT, "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: 4, execute: args.yes });
  if (!args.yes) return;
  const pairs: Pair[] = PERSONAS.map((p) => ({ id: p.id, kind: p.kind, survivor: `personas/${p.id}-survivor.jpg`, infected: `personas/${p.id}-infected.jpg` }));
  await writeFile(join(EVAL, "data", "pairs.json"), JSON.stringify(pairs, null, 2));
  console.log(`pairs.json written (${pairs.length} pairs). failed=${s.failed}: rerun to retry failures.`);
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
```

- [ ] **Step 6: 干跑确认计划与预估（不花钱）**

Run: `node eval/src/run-personas.ts`
Expected: 打印 `jobs=24 (skipping 0 done) estimated=$0.60 budget=$2` 和 `dry run — add --yes to execute`

- [ ] **Step 7: Commit**

```bash
git add eval/src/personas.ts eval/src/run-personas.ts eval/test/personas.test.ts
git commit -m "feat(eval): synthetic persona pairs and generator"
```

---

### Task 5: 分镜与提示词

**Files:**
- Create: `eval/src/storyboard.ts`
- Test: `eval/test/storyboard.test.ts`

**Interfaces:**
- Consumes: `Kind`（Task 4）
- Produces:
  - `type FrameId = "A" | "B" | "C"`
  - `REQUIRED_FACES: Record<FrameId, ("survivor" | "infected")[]>`
  - `keyframePrompt(frame: FrameId, kind: Kind): string`
  - `type ShotDef = { id: 1 | 2 | 3 | 4; targetSec: number; first: FrameId; last?: FrameId }`
  - `SHOTS: ShotDef[]`
  - `shotPrompt(id: ShotDef["id"], kind: Kind): string`

参考图顺序约定：A、C 传 `[survivor, infected]`；B 传 `[survivor, infected, A, C]`，提示词里分别称 IMAGE 1–4。

与规格 §5.1 的一处差异：镜头 2 从「幸存者面部特写」改为「握枪的手特写，手指离开扳机」——关键帧 A 里幸存者是背侧位，没有可用的正脸首帧；手部特写不需要人脸，情绪同样成立。Task 11 把这处改动写回规格。

- [ ] **Step 1: 写失败的测试 `eval/test/storyboard.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOTS, keyframePrompt, shotPrompt } from "../src/storyboard.ts";

const SAFE = /No blood, no gore, no biting, no gunfire, no text\./;

test("every keyframe and shot prompt carries the safety constraints", () => {
  for (const kind of ["human", "pet"] as const) {
    for (const f of ["A", "B", "C"] as const) assert.match(keyframePrompt(f, kind), SAFE);
    for (const s of SHOTS) assert.match(shotPrompt(s.id, kind), SAFE);
  }
});

test("keyframe B references all four input images", () => {
  const p = keyframePrompt("B", "human");
  for (const n of [1, 2, 3, 4]) assert.match(p, new RegExp(`IMAGE ${n}`));
});

test("pet version never puts a gun in the scene", () => {
  for (const f of ["A", "B", "C"] as const) assert.doesNotMatch(keyframePrompt(f, "pet"), /pistol|gun(?!fire)/i);
  for (const s of SHOTS) assert.doesNotMatch(shotPrompt(s.id, "pet"), /pistol|gun(?!fire)/i);
});

test("storyboard totals 11 seconds and shot 3 goes from A to B", () => {
  assert.equal(SHOTS.reduce((t, s) => t + s.targetSec, 0), 11);
  const s3 = SHOTS.find((s) => s.id === 3)!;
  assert.equal(s3.first, "A");
  assert.equal(s3.last, "B");
});

test("video shots ask for consistent faces and restrained motion", () => {
  for (const s of SHOTS) assert.match(shotPrompt(s.id, "human"), /Faces stay consistent/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test eval/test/storyboard.test.ts`
Expected: FAIL，找不到模块 `../src/storyboard.ts`

- [ ] **Step 3: 写 `eval/src/storyboard.ts`**

```ts
// Storyboard for the cabin → wheat field scene (spec §5). Prompts are drafts until the eval confirms them.
import type { Kind } from "./personas.ts";

export type FrameId = "A" | "B" | "C";
export type ShotDef = { id: 1 | 2 | 3 | 4; targetSec: number; first: FrameId; last?: FrameId };

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";
const CABIN = "Inside a dim abandoned wooden cabin, cold blue moonlight through broken boards, dust in the air, 35mm film grain.";
const FIELD = "Golden wheat field at sunset, warm backlight, lens flare, soft haze, 35mm film grain.";

// Which identities must be recognisable in each keyframe (used by face_score.py too).
export const REQUIRED_FACES: Record<FrameId, ("survivor" | "infected")[]> = {
  A: ["infected"],
  B: ["survivor", "infected"],
  C: ["survivor", "infected"],
};

function words(kind: Kind) {
  return kind === "human"
    ? {
        holds: "aiming a pistol",
        lowers: "slowly lowers the pistol, lets it fall",
        hands: "the survivor's hands on the pistol; the hands tremble and the index finger slides off the trigger",
        other: "infected partner",
        infected: "infected: pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing",
        healthy: "Both people healthy and smiling, clean casual clothes",
      }
    : {
        holds: "kneeling and holding a flashlight",
        lowers: "slowly sets the flashlight down",
        hands: "the survivor's hand on the flashlight; the hand trembles and slowly lowers the beam",
        other: "infected pet",
        infected: "infected: cloudy white eyes, patchy fur",
        healthy: "The person and the pet are healthy and happy",
      };
}

export function keyframePrompt(frame: FrameId, kind: Kind): string {
  const w = words(kind);
  const subject2 = kind === "human" ? "Person from IMAGE 2" : "The pet from IMAGE 2";
  if (frame === "A") {
    return [
      "Cinematic film still, vertical 9:16.",
      CABIN,
      `Person from IMAGE 1 stands in the foreground, back three-quarter view, ${w.holds}, wearing a worn olive jacket.`,
      `${subject2} is in the doorway, backlit, ${w.infected} — but clearly recognizable as IMAGE 2: same face shape, features and hair or fur.`,
      "Keep both identities exact.",
      SAFE,
    ].join(" ");
  }
  if (frame === "C") {
    return [
      "Cinematic film still, vertical 9:16.",
      FIELD,
      `${w.healthy}, embracing, front three-quarter view.`,
      "Person from IMAGE 1 and the subject from IMAGE 2, identities exact.",
      SAFE,
    ].join(" ");
  }
  return [
    "Cinematic film still, vertical 9:16.",
    "IMAGE 1 is the survivor. IMAGE 2 is the one who turned. IMAGE 3 is the scene reference. IMAGE 4 is the pose reference.",
    "Use exactly the same pose, framing and camera angle as IMAGE 4.",
    "Use the cabin, lighting and the infected look from IMAGE 3.",
    `Person from IMAGE 1 embraces the ${w.other} from IMAGE 2, identities exact.`,
    SAFE,
  ].join(" ");
}

export const SHOTS: ShotDef[] = [
  { id: 1, targetSec: 3, first: "A" },
  { id: 2, targetSec: 2.5, first: "A" },
  { id: 3, targetSec: 2.5, first: "A", last: "B" },
  { id: 4, targetSec: 3, first: "C" },
];

export function shotPrompt(id: ShotDef["id"], kind: Kind): string {
  const w = words(kind);
  const body = {
    1: `Slow push-in from behind the survivor's shoulder. The survivor keeps ${w.holds}, trembling slightly. The ${w.other} slowly turns its head toward camera. Dust particles drift in moonlight. No lunging, no camera shake.`,
    2: `Slow push-in to a close-up of ${w.hands}. Shallow depth of field, cold blue moonlight.`,
    3: `The survivor ${w.lowers}, and opens both arms. The ${w.other} steps forward into the embrace; they hold each other tightly. Slow orbit camera. Emotional, gentle.`,
    4: "Slow-motion pull back. They laugh while hugging, wind moves their hair and the wheat. Golden hour sunlight, warm glow. Natural, joyful motion.",
  }[id];
  return `${body} ${MOTION} ${SAFE}`;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test eval/test/storyboard.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add eval/src/storyboard.ts eval/test/storyboard.test.ts
git commit -m "feat(eval): storyboard and prompt builders for human and pet versions"
```

---

### Task 6: 候选模型映射

**Files:**
- Create: `eval/src/candidates.ts`
- Test: `eval/test/candidates.test.ts`

**Interfaces:**
- Produces:
  - `type ImageCandidate = { key: string; model: string; estUsd: (refs: number) => number; input: (p: { prompt: string; refs: string[] }) => Record<string, unknown> }`
  - `IMAGE_CANDIDATES: ImageCandidate[]`（keys：`nb2`、`nbpro`、`sd5pro`、`gptimg2`、`flux2pro`）
  - `type VideoCandidate = { key: string; model: string; minSec: number; maxSec: number; allowedSec?: number[]; estUsd: (sec: number) => number; input: (p: { prompt: string; first: string; last?: string; sec: number }) => Record<string, unknown> }`
  - `VIDEO_CANDIDATES: VideoCandidate[]`（keys：`sd2mini`、`sd2fast`、`kling3std`、`veo31lite`、`wan27`）
  - `pickSeconds(c: VideoCandidate, targetSec: number): number`

字段名与价格来自 2026-10-14 拉取的 kie schema 和 pricingDesc（`/api/v1/models/<model>/schema`），实际花费以返回的 `creditsConsumed` 为准。

- [ ] **Step 1: 写失败的测试 `eval/test/candidates.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { IMAGE_CANDIDATES, VIDEO_CANDIDATES, pickSeconds } from "../src/candidates.ts";

const video = (k: string) => VIDEO_CANDIDATES.find((c) => c.key === k)!;
const image = (k: string) => IMAGE_CANDIDATES.find((c) => c.key === k)!;

test("pickSeconds rounds up to the model's minimum and allowed values", () => {
  assert.equal(pickSeconds(video("sd2mini"), 2.5), 4);
  assert.equal(pickSeconds(video("kling3std"), 2.5), 3);
  assert.equal(pickSeconds(video("veo31lite"), 3), 4);
  assert.equal(pickSeconds(video("veo31lite"), 5), 6);
  assert.equal(pickSeconds(video("wan27"), 2.5), 3);
});

test("seedance uses first/last frame fields, no audio, 9:16", () => {
  const i = video("sd2mini").input({ prompt: "p", first: "f", last: "l", sec: 4 });
  assert.deepEqual(i, { prompt: "p", first_frame_url: "f", last_frame_url: "l", resolution: "720p", aspect_ratio: "9:16", duration: 4, generate_audio: false });
});

test("first-frame-only shots omit last frame fields", () => {
  assert.equal("last_frame_url" in video("sd2fast").input({ prompt: "p", first: "f", sec: 4 }), false);
  assert.deepEqual(video("kling3std").input({ prompt: "p", first: "f", sec: 3 }).image_urls, ["f"]);
  assert.deepEqual(video("veo31lite").input({ prompt: "p", first: "f", last: "l", sec: 4 }).image_urls, ["f", "l"]);
});

test("kling wants duration as a string and no sound", () => {
  const i = video("kling3std").input({ prompt: "p", first: "f", sec: 3 });
  assert.equal(i.duration, "3");
  assert.equal(i.sound, false);
  assert.equal(i.multi_shots, false);
});

test("image candidates pass all refs under each model's own field", () => {
  const refs = ["a", "b", "c", "d"];
  assert.deepEqual(image("nb2").input({ prompt: "p", refs }).image_input, refs);
  assert.deepEqual(image("sd5pro").input({ prompt: "p", refs }).image_urls, refs);
  assert.deepEqual(image("gptimg2").input({ prompt: "p", refs }).input_urls, refs);
  assert.deepEqual(image("flux2pro").input({ prompt: "p", refs }).input_urls, refs);
  assert.equal(image("sd5pro").estUsd(4), 0.035 + 3 * 0.0025);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test eval/test/candidates.test.ts`
Expected: FAIL，找不到模块 `../src/candidates.ts`

- [ ] **Step 3: 写 `eval/src/candidates.ts`**

```ts
// Candidate kie models for keyframes (image edit, multi-reference) and shots (image-to-video with first/last frame).
// Fields and prices from kie schema + pricingDesc fetched 2026-10-14; real spend comes from creditsConsumed.

export type ImageCandidate = {
  key: string;
  model: string;
  estUsd: (refs: number) => number;
  input: (p: { prompt: string; refs: string[] }) => Record<string, unknown>;
};

export const IMAGE_CANDIDATES: ImageCandidate[] = [
  {
    key: "nb2",
    model: "nano-banana-2",
    estUsd: () => 0.025,
    input: ({ prompt, refs }) => ({ prompt, image_input: refs, aspect_ratio: "9:16", resolution: "1K", output_format: "jpg" }),
  },
  {
    key: "nbpro",
    model: "nano-banana-pro",
    estUsd: () => 0.04,
    input: ({ prompt, refs }) => ({ prompt, image_input: refs, aspect_ratio: "9:16", resolution: "1K", output_format: "jpg" }),
  },
  {
    key: "sd5pro",
    model: "seedream/5-pro-image-to-image",
    estUsd: (refs) => 0.035 + Math.max(0, refs - 1) * 0.0025, // first input image free, then $0.0025 each
    input: ({ prompt, refs }) => ({ prompt, image_urls: refs, aspect_ratio: "9:16", quality: "basic", output_format: "jpeg" }),
  },
  {
    key: "gptimg2",
    model: "gpt-image-2-image-to-image",
    estUsd: () => 0.015,
    input: ({ prompt, refs }) => ({ prompt, input_urls: refs, aspect_ratio: "9:16", resolution: "1K" }),
  },
  {
    key: "flux2pro",
    model: "flux-2/pro-image-to-image",
    estUsd: () => 0.025,
    input: ({ prompt, refs }) => ({ prompt, input_urls: refs, aspect_ratio: "9:16", resolution: "1K" }),
  },
];

export type VideoCandidate = {
  key: string;
  model: string;
  minSec: number;
  maxSec: number;
  allowedSec?: number[];
  estUsd: (sec: number) => number;
  input: (p: { prompt: string; first: string; last?: string; sec: number }) => Record<string, unknown>;
};

const seedance = (key: string, model: string, usdPerSec: number): VideoCandidate => ({
  key,
  model,
  minSec: 4,
  maxSec: 15,
  estUsd: (sec) => sec * usdPerSec,
  input: ({ prompt, first, last, sec }) => ({
    prompt,
    first_frame_url: first,
    ...(last ? { last_frame_url: last } : {}),
    resolution: "720p",
    aspect_ratio: "9:16",
    duration: sec,
    generate_audio: false,
  }),
});

export const VIDEO_CANDIDATES: VideoCandidate[] = [
  seedance("sd2mini", "bytedance/seedance-2-mini", 0.041),
  seedance("sd2fast", "bytedance/seedance-2-fast", 0.124),
  {
    key: "kling3std",
    model: "kling-3.0/video",
    minSec: 3,
    maxSec: 15,
    estUsd: (sec) => sec * 0.07,
    // aspect ratio follows the first frame when image_urls is given
    input: ({ prompt, first, last, sec }) => ({ prompt, image_urls: last ? [first, last] : [first], sound: false, duration: String(sec), mode: "std", multi_shots: false }),
  },
  {
    key: "veo31lite",
    model: "veo-3-1",
    minSec: 4,
    maxSec: 8,
    allowedSec: [4, 6, 8],
    estUsd: () => 0.075, // Lite 720p is priced per video
    input: ({ prompt, first, last, sec }) => ({
      prompt,
      model: "veo3_lite",
      generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO",
      image_urls: last ? [first, last] : [first],
      aspect_ratio: "9:16",
      resolution: "720p",
      duration: sec,
    }),
  },
  {
    key: "wan27",
    model: "wan/2-7-image-to-video",
    minSec: 2,
    maxSec: 15,
    estUsd: (sec) => sec * 0.08,
    input: ({ prompt, first, last, sec }) => ({
      prompt,
      negative_prompt: "blood, gore, biting, gunfire, text, extra people, face merging",
      first_frame_url: first,
      ...(last ? { last_frame_url: last } : {}),
      resolution: "720p",
      duration: sec,
      prompt_extend: false,
    }),
  },
];

export function pickSeconds(c: VideoCandidate, targetSec: number): number {
  const want = Math.min(c.maxSec, Math.max(c.minSec, Math.ceil(targetSec)));
  if (!c.allowedSec) return want;
  return c.allowedSec.find((s) => s >= want) ?? c.allowedSec[c.allowedSec.length - 1];
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test eval/test/candidates.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add eval/src/candidates.ts eval/test/candidates.test.ts
git commit -m "feat(eval): keyframe and video candidate model mappings"
```

---

### Task 7: 关键帧与镜头的命令行脚本

**Files:**
- Create: `eval/src/plan.ts`
- Create: `eval/src/run-keyframes.ts`
- Create: `eval/src/run-shots.ts`
- Test: `eval/test/plan.test.ts`

**Interfaces:**
- Consumes: `Pair`、`loadPairs`（Task 4）；`keyframePrompt`、`SHOTS`、`shotPrompt`（Task 5）；`IMAGE_CANDIDATES`、`VIDEO_CANDIDATES`、`pickSeconds`（Task 6）；`runJobs`、`runKieTask`（Task 3）；`KieClient`、`UploadCache`（Task 2）；`loadKey`（Task 1）
- Produces:
  - `type Picks = Record<string /* pair */, Record<string /* image model key */, Partial<Record<FrameId, string /* abs path */>>>>`（由 Task 8 的 `face_score.py` 写入 `<run>/picks.json`）
  - `type KfSpec = { key: string; pair: Pair; model: ImageCandidate; frame: FrameId; cand: number; refs: string[]; prompt: string; out: string }`
  - `planKeyframes(o: { pairs: Pair[]; models: ImageCandidate[]; stage: "AC" | "B"; candidates: number; dataDir: string; runDir: string; picks: Picks }): { specs: KfSpec[]; missing: string[] }`
  - `type ShotSpec = { key: string; pair: Pair; model: VideoCandidate; shot: ShotDef; sec: number; first: string; last?: string; prompt: string; out: string }`
  - `planShots(o: { pairs: Pair[]; models: VideoCandidate[]; shots: ShotDef[]; kfModel: string; runDir: string; picks: Picks }): { specs: ShotSpec[]; missing: string[] }`

阶段 AC 每组每模型每帧生成 `--candidates` 张（默认 2）；阶段 B 需要 `picks.json` 里该组该模型已有 A 和 C，否则列进 `missing` 并跳过。镜头阶段需要 `--kf-model` 指定用哪个图像模型的最佳 A / B / C。

- [ ] **Step 1: 写失败的测试 `eval/test/plan.test.ts`**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planKeyframes, planShots } from "../src/plan.ts";
import { IMAGE_CANDIDATES, VIDEO_CANDIDATES } from "../src/candidates.ts";
import { SHOTS } from "../src/storyboard.ts";
import type { Pair } from "../src/personas.ts";

const pairs: Pair[] = [
  { id: "p01", kind: "human", survivor: "personas/p01-survivor.jpg", infected: "personas/p01-infected.jpg" },
  { id: "p02", kind: "human", survivor: "personas/p02-survivor.jpg", infected: "personas/p02-infected.jpg" },
];
const nb2 = IMAGE_CANDIDATES.filter((c) => c.key === "nb2");

test("stage AC: pairs × models × {A,C} × candidates, refs are the two photos", () => {
  const { specs } = planKeyframes({ pairs, models: nb2, stage: "AC", candidates: 2, dataDir: "/d", runDir: "/r", picks: {} });
  assert.equal(specs.length, 2 * 1 * 2 * 2);
  assert.deepEqual(specs[0].refs, ["/d/personas/p01-survivor.jpg", "/d/personas/p01-infected.jpg"]);
  assert.equal(specs[0].out, "/r/kf/nb2/p01/A-1.jpg");
  assert.equal(specs[0].key, "nb2|p01|A|1");
});

test("stage B needs picked A and C, otherwise reports missing", () => {
  const picks = { p01: { nb2: { A: "/r/a.jpg", C: "/r/c.jpg" } } };
  const { specs, missing } = planKeyframes({ pairs, models: nb2, stage: "B", candidates: 2, dataDir: "/d", runDir: "/r", picks });
  assert.equal(specs.length, 1); // one B per pair/model, candidates only apply to stage AC
  assert.equal(specs[0].out, "/r/kf/nb2/p01/B-1.jpg");
  assert.deepEqual(specs[0].refs.slice(2), ["/r/a.jpg", "/r/c.jpg"]);
  assert.deepEqual(missing, ["p02/nb2"]);
});

test("shots use picked keyframes and round seconds per model", () => {
  const picks = { p01: { nb2: { A: "/a", B: "/b", C: "/c" } } };
  const sd = VIDEO_CANDIDATES.filter((c) => c.key === "sd2mini");
  const { specs, missing } = planShots({ pairs, models: sd, shots: SHOTS, kfModel: "nb2", runDir: "/r", picks });
  assert.equal(specs.length, 4);
  const s3 = specs.find((s) => s.shot.id === 3)!;
  assert.equal(s3.first, "/a");
  assert.equal(s3.last, "/b");
  assert.equal(s3.sec, 4);
  assert.equal(s3.out, "/r/shots/sd2mini/p01/shot3.mp4");
  assert.deepEqual(missing, ["p02/nb2"]);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test eval/test/plan.test.ts`
Expected: FAIL，找不到模块 `../src/plan.ts`

- [ ] **Step 3: 写 `eval/src/plan.ts`**

```ts
// Pure planning: which keyframe / shot jobs to run, from pairs, models and picks.json.
import { join } from "node:path";
import type { Pair } from "./personas.ts";
import type { ImageCandidate, VideoCandidate } from "./candidates.ts";
import { pickSeconds } from "./candidates.ts";
import { keyframePrompt, shotPrompt, type FrameId, type ShotDef } from "./storyboard.ts";

export type Picks = Record<string, Record<string, Partial<Record<FrameId, string>>>>;
export type KfSpec = { key: string; pair: Pair; model: ImageCandidate; frame: FrameId; cand: number; refs: string[]; prompt: string; out: string };
export type ShotSpec = { key: string; pair: Pair; model: VideoCandidate; shot: ShotDef; sec: number; first: string; last?: string; prompt: string; out: string };

export function planKeyframes(o: {
  pairs: Pair[];
  models: ImageCandidate[];
  stage: "AC" | "B";
  candidates: number;
  dataDir: string;
  runDir: string;
  picks: Picks;
}): { specs: KfSpec[]; missing: string[] } {
  const specs: KfSpec[] = [];
  const missing: string[] = [];
  const frames: FrameId[] = o.stage === "AC" ? ["A", "C"] : ["B"];
  const count = o.stage === "AC" ? o.candidates : 1;
  for (const pair of o.pairs) {
    const photos = [join(o.dataDir, pair.survivor), join(o.dataDir, pair.infected)];
    for (const model of o.models) {
      let refs = photos;
      if (o.stage === "B") {
        const p = o.picks[pair.id]?.[model.key];
        if (!p?.A || !p?.C) {
          missing.push(`${pair.id}/${model.key}`);
          continue;
        }
        refs = [...photos, p.A, p.C];
      }
      for (const frame of frames) {
        for (let cand = 1; cand <= count; cand++) {
          specs.push({
            key: `${model.key}|${pair.id}|${frame}|${cand}`,
            pair,
            model,
            frame,
            cand,
            refs,
            prompt: keyframePrompt(frame, pair.kind),
            out: join(o.runDir, "kf", model.key, pair.id, `${frame}-${cand}.jpg`),
          });
        }
      }
    }
  }
  return { specs, missing };
}

export function planShots(o: {
  pairs: Pair[];
  models: VideoCandidate[];
  shots: ShotDef[];
  kfModel: string;
  runDir: string;
  picks: Picks;
}): { specs: ShotSpec[]; missing: string[] } {
  const specs: ShotSpec[] = [];
  const missing: string[] = [];
  for (const pair of o.pairs) {
    const p = o.picks[pair.id]?.[o.kfModel];
    const needed = new Set(o.shots.flatMap((s) => (s.last ? [s.first, s.last] : [s.first])));
    if (!p || [...needed].some((f) => !p[f])) {
      missing.push(`${pair.id}/${o.kfModel}`);
      continue;
    }
    for (const model of o.models) {
      for (const shot of o.shots) {
        specs.push({
          key: `${o.kfModel}|${model.key}|${pair.id}|${shot.id}`,
          pair,
          model,
          shot,
          sec: pickSeconds(model, shot.targetSec),
          first: p[shot.first]!,
          last: shot.last ? p[shot.last] : undefined,
          prompt: shotPrompt(shot.id, pair.kind),
          out: join(o.runDir, "shots", model.key, pair.id, `shot${shot.id}.mp4`),
        });
      }
    }
  }
  return { specs, missing };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test eval/test/plan.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 写 `eval/src/run-keyframes.ts`**

```ts
// Generate keyframes A/C (stage AC) or B (stage B, needs picks.json from face_score.py).
//   node eval/src/run-keyframes.ts --run r1 --stage AC|B [--models nb2,sd5pro] [--pairs p01,p02] [--kind human] [--candidates 2] [--budget 10] [--concurrency 4] [--yes]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { IMAGE_CANDIDATES } from "./candidates.ts";
import { loadPairs } from "./personas.ts";
import { planKeyframes, type Picks } from "./plan.ts";

const EVAL = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    run: { type: "string", default: "r1" },
    stage: { type: "string", default: "AC" },
    models: { type: "string" },
    pairs: { type: "string" },
    kind: { type: "string", default: "human" },
    candidates: { type: "string", default: "2" },
    budget: { type: "string", default: "10" },
    concurrency: { type: "string", default: "4" },
    yes: { type: "boolean", default: false },
  },
});

async function main() {
  if (args.stage !== "AC" && args.stage !== "B") throw new Error("--stage must be AC or B");
  const runDir = join(EVAL, "results", args.run!);
  const picksFile = join(runDir, "picks.json");
  const picks: Picks = existsSync(picksFile) ? JSON.parse(await readFile(picksFile, "utf8")) : {};
  const pairs = (await loadPairs(EVAL)).filter((p) => p.kind === args.kind && (!args.pairs || args.pairs.split(",").includes(p.id)));
  const models = args.models ? IMAGE_CANDIDATES.filter((c) => args.models!.split(",").includes(c.key)) : IMAGE_CANDIDATES;
  const { specs, missing } = planKeyframes({ pairs, models, stage: args.stage, candidates: Number(args.candidates), dataDir: join(EVAL, "data"), runDir, picks });
  if (missing.length) console.warn(`skipping (no picked A/C yet — run face_score.py first): ${missing.join(", ")}`);

  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));
  if (args.yes) await mkdir(runDir, { recursive: true });

  const jobs: Job[] = specs.map((s) => ({
    key: s.key,
    estUsd: s.model.estUsd(s.refs.length),
    meta: { model: s.model.key, pair: s.pair.id, frame: s.frame, cand: s.cand },
    run: async () => {
      const refs = await Promise.all(s.refs.map((p) => uploads.urlFor(p)));
      return runKieTask({
        kie,
        model: s.model.model,
        input: s.model.input({ prompt: s.prompt, refs }),
        estUsd: s.model.estUsd(s.refs.length),
        timeoutMs: 5 * 60_000,
        save: async (bytes) => {
          await mkdir(dirname(s.out), { recursive: true });
          await writeFile(s.out, bytes);
          return s.out;
        },
      });
    },
  }));
  await runJobs({ resultsFile: join(runDir, "kf", "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: args.yes });
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
```

- [ ] **Step 6: 写 `eval/src/run-shots.ts`**

```ts
// Generate the 4 storyboard shots per pair per video model, from picked keyframes of one image model.
//   node eval/src/run-shots.ts --run r1 --kf-model nb2 [--models sd2mini,kling3std] [--pairs p01,p07] [--shots 1,2,3,4] [--kind human] [--budget 10] [--concurrency 3] [--yes]
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadKey } from "./env.ts";
import { KieClient, UploadCache } from "./kie.ts";
import { runJobs, type Job } from "./runner.ts";
import { runKieTask } from "./kie-job.ts";
import { VIDEO_CANDIDATES } from "./candidates.ts";
import { loadPairs } from "./personas.ts";
import { SHOTS } from "./storyboard.ts";
import { planShots, type Picks } from "./plan.ts";

const EVAL = resolve(import.meta.dirname, "..");
const { values: args } = parseArgs({
  options: {
    run: { type: "string", default: "r1" },
    "kf-model": { type: "string" },
    models: { type: "string" },
    pairs: { type: "string" },
    shots: { type: "string" },
    kind: { type: "string", default: "human" },
    budget: { type: "string", default: "10" },
    concurrency: { type: "string", default: "3" },
    yes: { type: "boolean", default: false },
  },
});

async function main() {
  const kfModel = args["kf-model"];
  if (!kfModel) throw new Error("--kf-model is required (image model whose picked keyframes to use)");
  const runDir = join(EVAL, "results", args.run!);
  const picksFile = join(runDir, "picks.json");
  if (!existsSync(picksFile)) throw new Error(`no ${picksFile}: run face_score.py after the keyframe stages`);
  const picks: Picks = JSON.parse(await readFile(picksFile, "utf8"));
  const pairs = (await loadPairs(EVAL)).filter((p) => p.kind === args.kind && (!args.pairs || args.pairs.split(",").includes(p.id)));
  const models = args.models ? VIDEO_CANDIDATES.filter((c) => args.models!.split(",").includes(c.key)) : VIDEO_CANDIDATES;
  const shots = args.shots ? SHOTS.filter((s) => args.shots!.split(",").includes(String(s.id))) : SHOTS;
  const { specs, missing } = planShots({ pairs, models, shots, kfModel, runDir, picks });
  if (missing.length) console.warn(`skipping (picks.json lacks A/B/C for ${kfModel}): ${missing.join(", ")}`);

  const kie = args.yes ? new KieClient(await loadKey()) : (null as unknown as KieClient);
  const uploads = new UploadCache(kie, join(runDir, "uploads-cache.json"));

  const jobs: Job[] = specs.map((s) => ({
    key: s.key,
    estUsd: s.model.estUsd(s.sec),
    meta: { kfModel, model: s.model.key, pair: s.pair.id, shot: s.shot.id, sec: s.sec, targetSec: s.shot.targetSec },
    run: async () => {
      const first = await uploads.urlFor(s.first);
      const last = s.last ? await uploads.urlFor(s.last) : undefined;
      return runKieTask({
        kie,
        model: s.model.model,
        input: s.model.input({ prompt: s.prompt, first, last, sec: s.sec }),
        estUsd: s.model.estUsd(s.sec),
        timeoutMs: 15 * 60_000,
        save: async (bytes) => {
          await mkdir(dirname(s.out), { recursive: true });
          await writeFile(s.out, bytes);
          return s.out;
        },
      });
    },
  }));
  await runJobs({ resultsFile: join(runDir, "shots", "results.jsonl"), jobs, budgetUsd: Number(args.budget), concurrency: Number(args.concurrency), execute: args.yes });
}

main().catch((e) => {
  console.error((e as Error).message ?? e);
  process.exit(1);
});
```

- [ ] **Step 7: 跑全部单测**

Run: `node --test eval/test/`
Expected: PASS（全部 tests）

- [ ] **Step 8: Commit**

```bash
git add eval/src/plan.ts eval/src/run-keyframes.ts eval/src/run-shots.ts eval/test/plan.test.ts
git commit -m "feat(eval): keyframe and shot runners driven by picks.json"
```

---

### Task 8: 人脸相似度打分

**Files:**
- Create: `eval/scripts/face_score.py`

**Interfaces:**
- Consumes: `eval/data/pairs.json`（Task 4）；`<run>/kf/results.jsonl`、`<run>/shots/results.jsonl` 行内 `meta`（Task 7）
- Produces:
  - `<run>/scores.json`：`{ "kf": [{ model, pair, frame, cand, path, survivor, infected, score }], "shots": [{ kfModel, model, pair, shot, path, survivor, infected, score }] }`，相似度为余弦值，检测不到为 `null`
  - `<run>/picks.json`：`Picks`（每组每图像模型每帧取 `score` 最高的候选；全部为 `null` 时取第 1 个候选）

规则（与 `storyboard.ts` 的 `REQUIRED_FACES` 一致）：A 只看 infected；B、C 看两人；镜头 1 看 infected，镜头 2 不看脸，镜头 3、4 看两人。`score` = 需要的身份里有值者的平均；图片里取所有检测到的脸与原照片的最大余弦；视频每秒取 1 帧，取各帧的中位数。宠物组（kind=pet）跳过人脸打分，只为人脸那一方打分。

- [ ] **Step 1: 写 `eval/scripts/face_score.py`**

```python
# /// script
# requires-python = ">=3.12"
# dependencies = ["insightface==0.7.3", "onnxruntime==1.20.1", "opencv-python-headless==4.10.0.84", "numpy<2.1"]
# ///
"""Face-identity scores for keyframes and shots; writes scores.json and picks.json.

usage: uv run eval/scripts/face_score.py eval/results/<run>
"""
import json
import statistics
import sys
from pathlib import Path

import cv2
import numpy as np
from insightface.app import FaceAnalysis

EVAL = Path(__file__).resolve().parent.parent
REQUIRED_KF = {"A": ["infected"], "B": ["survivor", "infected"], "C": ["survivor", "infected"]}
REQUIRED_SHOT = {1: ["infected"], 2: [], 3: ["survivor", "infected"], 4: ["survivor", "infected"]}


def rows(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def embeddings(app, img):
    if img is None:
        return []
    return [f.normed_embedding for f in app.get(img)]


def best_sim(faces, ref):
    if ref is None or not faces:
        return None
    return float(max(np.dot(f, ref) for f in faces))


def score_image(app, path, refs, required):
    """Max cosine per required identity; None when no face is found (never raises)."""
    faces = embeddings(app, cv2.imread(str(path)))
    sims = {who: best_sim(faces, refs.get(who)) for who in ("survivor", "infected")}
    vals = [sims[w] for w in required if sims[w] is not None]
    return sims, (sum(vals) / len(vals) if vals else None)


def score_video(app, path, refs, required):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    per = {"survivor": [], "infected": []}
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if i % int(round(fps)) == 0:
            faces = embeddings(app, frame)
            for who in per:
                s = best_sim(faces, refs.get(who))
                if s is not None:
                    per[who].append(s)
        i += 1
    cap.release()
    sims = {w: (statistics.median(v) if v else None) for w, v in per.items()}
    vals = [sims[w] for w in required if sims[w] is not None]
    return sims, (sum(vals) / len(vals) if vals else None)


def main(run_dir: Path):
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=-1, det_size=(640, 640))
    pairs = {p["id"]: p for p in json.loads((EVAL / "data" / "pairs.json").read_text())}

    refs = {}
    for pid, p in pairs.items():
        r = {}
        for who in ("survivor", "infected"):
            if p["kind"] == "pet" and who == "infected":
                continue  # animals are not scored with a human face model
            faces = embeddings(app, cv2.imread(str(EVAL / "data" / p[who])))
            r[who] = faces[0] if faces else None
            if r[who] is None:
                print(f"warning: no face in source {p[who]}")
        refs[pid] = r

    def req(pid, names):
        return [n for n in names if refs[pid].get(n) is not None]

    out = {"kf": [], "shots": []}
    for r in rows(run_dir / "kf" / "results.jsonl"):
        if r.get("status") != "succeeded":
            continue
        m = r["meta"]
        sims, score = score_image(app, r["outputs"][0], refs[m["pair"]], req(m["pair"], REQUIRED_KF[m["frame"]]))
        out["kf"].append({**{k: m[k] for k in ("model", "pair", "frame", "cand")}, "path": r["outputs"][0], **sims, "score": score})
    for r in rows(run_dir / "shots" / "results.jsonl"):
        if r.get("status") != "succeeded":
            continue
        m = r["meta"]
        sims, score = score_video(app, r["outputs"][0], refs[m["pair"]], req(m["pair"], REQUIRED_SHOT[m["shot"]]))
        out["shots"].append({**{k: m[k] for k in ("kfModel", "model", "pair", "shot")}, "path": r["outputs"][0], **sims, "score": score})

    picks: dict = {}
    for e in sorted(out["kf"], key=lambda e: e["cand"]):
        slot = picks.setdefault(e["pair"], {}).setdefault(e["model"], {})
        cur = slot.get(e["frame"])
        cur_score = next((x["score"] for x in out["kf"] if x["path"] == cur), None) if cur else None
        if cur is None or (e["score"] is not None and (cur_score is None or e["score"] > cur_score)):
            slot[e["frame"]] = e["path"]

    (run_dir / "scores.json").write_text(json.dumps(out, indent=1))
    (run_dir / "picks.json").write_text(json.dumps(picks, indent=1))
    none = sum(1 for e in out["kf"] + out["shots"] if e["score"] is None)
    print(f"scored {len(out['kf'])} keyframes, {len(out['shots'])} shots ({none} without a detectable face)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/face_score.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
```

- [ ] **Step 2: 自检——空运行目录不崩溃**

Run:
```bash
mkdir -p eval/results/selfcheck
[ -f eval/data/pairs.json ] || echo '[]' > eval/data/pairs.json
uv run eval/scripts/face_score.py eval/results/selfcheck
```
Expected: 首次会下载 buffalo_l 模型（约 300MB），然后打印 `scored 0 keyframes, 0 shots (0 without a detectable face)`；`eval/results/selfcheck/picks.json` 内容为 `{}`

- [ ] **Step 3: 自检——无人脸图片记 null 不崩溃**

Run:
```bash
uv run --with opencv-python-headless==4.10.0.84 --with numpy python -c "import cv2,numpy as np; cv2.imwrite('eval/results/selfcheck/blank.jpg', np.zeros((640,360,3),np.uint8))"
mkdir -p eval/results/selfcheck/kf
printf '%s\n' '{"key":"x","status":"succeeded","outputs":["eval/results/selfcheck/blank.jpg"],"meta":{"model":"nb2","pair":"p01","frame":"C","cand":1}}' > eval/results/selfcheck/kf/results.jsonl
```
（需要 `eval/data/pairs.json` 已含 p01，即 Task 4 的生成已执行；未执行时跳过本步，Task 9 第一次打分时再确认。）
Run: `uv run eval/scripts/face_score.py eval/results/selfcheck`
Expected: `scored 1 keyframes, 0 shots (1 without a detectable face)`；`picks.json` 为 `{"p01": {"nb2": {"C": "eval/results/selfcheck/blank.jpg"}}}`

- [ ] **Step 4: 清理并提交**

```bash
rm -rf eval/results/selfcheck
git add eval/scripts/face_score.py
git commit -m "feat(eval): insightface identity scoring and best-candidate picks"
```

---

### Task 9: 拼接与盲评页面

**Files:**
- Create: `eval/scripts/stitch.py`
- Create: `eval/scripts/report.py`

**Interfaces:**
- Consumes: `<run>/shots/results.jsonl`（meta 含 `kfModel`、`model`、`pair`、`shot`、`targetSec`）、`<run>/kf/results.jsonl`、`<run>/scores.json`、`eval/data/pairs.json`
- Produces: `<run>/stitched/<kfModel>-<model>/<pair>.mp4`；`<run>/review.html`；`<run>/blind-key.json`（盲评编号 → 真实模型）

拼接：只拼 4 个镜头都成功的组合；每段 `-t targetSec` 剪切、统一缩放到 720×1280、24fps、去音轨，然后 concat。盲评页：先放汇总表（按阶段 + 模型：成功数 / 总数、平均花费、p50 / p90 耗时、平均相似度），再按组展示原照片、各模型关键帧（标签打乱为 M1、M2…）、拼接成片；每项 1–5 分单选和 ⚠ 勾选，分数存在浏览器 localStorage，「Export」按钮下载 `ratings.json`。

- [ ] **Step 1: 写 `eval/scripts/stitch.py`**

```python
# /// script
# requires-python = ">=3.12"
# ///
"""Trim each shot to its target length and concatenate into one 9:16 clip per (kfModel, model, pair).

usage: uv run eval/scripts/stitch.py eval/results/<run>   (needs ffmpeg on PATH)
"""
import json
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path


def main(run_dir: Path):
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found: brew install ffmpeg")
    res = run_dir / "shots" / "results.jsonl"
    if not res.exists():
        sys.exit(f"no {res}")
    groups = defaultdict(dict)
    for line in res.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if r.get("status") == "succeeded":
            m = r["meta"]
            groups[(m["kfModel"], m["model"], m["pair"])][m["shot"]] = (r["outputs"][0], m["targetSec"])
    made = 0
    for (kf, model, pair), shots in sorted(groups.items()):
        if sorted(shots) != [1, 2, 3, 4]:
            print(f"skip {kf}-{model}/{pair}: shots {sorted(shots)} incomplete")
            continue
        out = run_dir / "stitched" / f"{kf}-{model}" / f"{pair}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            parts = []
            for i in (1, 2, 3, 4):
                src, sec = shots[i]
                part = Path(tmp) / f"{i}.mp4"
                subprocess.run(
                    ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-t", str(sec),
                     "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24",
                     "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(part)],
                    check=True,
                )
                parts.append(part)
            lst = Path(tmp) / "list.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in parts))
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(out)], check=True)
        made += 1
    print(f"stitched {made} clips into {run_dir / 'stitched'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/stitch.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
```

- [ ] **Step 2: 写 `eval/scripts/report.py`**

```python
# /// script
# requires-python = ">=3.12"
# ///
"""Summary table + blind review page for one eval run.

usage: uv run eval/scripts/report.py eval/results/<run>
"""
import html
import json
import os
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

EVAL = Path(__file__).resolve().parent.parent


def rows(path: Path):
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


def pct(values, q):
    if not values:
        return None
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def summary(stage, results, scores):
    by = defaultdict(list)
    for r in results:
        by[r["meta"]["model"]].append(r)
    sc = defaultdict(list)
    for s in scores:
        if s["score"] is not None:
            sc[s["model"]].append(s["score"])
    out = []
    for model, rs in sorted(by.items()):
        ok = [r for r in rs if r["status"] == "succeeded"]
        lat = [r["latencyMs"] / 1000 for r in ok]
        cost = [r["costUsd"] for r in rs]
        out.append(
            f"<tr><td>{stage}</td><td>{model}</td><td>{len(ok)}/{len(rs)}</td>"
            f"<td>${statistics.mean(cost):.3f}</td><td>{pct(lat, .5) or 0:.0f}s</td><td>{pct(lat, .9) or 0:.0f}s</td>"
            f"<td>{statistics.mean(sc[model]) if sc[model] else 0:.3f}</td></tr>"
        )
    return "".join(out)


def rel(run_dir, p):
    return html.escape(os.path.relpath(p, run_dir))


def rating(item_id):
    radios = "".join(f'<label><input type="radio" name="{item_id}" value="{n}">{n}</label>' for n in range(1, 6))
    return f'<div class="rate" data-id="{item_id}">{radios}<label><input type="checkbox" name="{item_id}-veto">⚠</label></div>'


def main(run_dir: Path):
    kf = rows(run_dir / "kf" / "results.jsonl")
    shots = rows(run_dir / "shots" / "results.jsonl")
    scores = json.loads((run_dir / "scores.json").read_text()) if (run_dir / "scores.json").exists() else {"kf": [], "shots": []}
    pairs = json.loads((EVAL / "data" / "pairs.json").read_text())

    models = sorted({r["meta"]["model"] for r in kf} | {f'{r["meta"]["kfModel"]}-{r["meta"]["model"]}' for r in shots})
    rng = random.Random(run_dir.name)
    shuffled = models[:]
    rng.shuffle(shuffled)
    blind = {m: f"M{i + 1}" for i, m in enumerate(shuffled)}
    (run_dir / "blind-key.json").write_text(json.dumps({v: k for k, v in blind.items()}, indent=1))

    body = [
        "<h1>Eval run " + html.escape(run_dir.name) + "</h1>",
        "<table><tr><th>stage</th><th>model</th><th>ok</th><th>avg $</th><th>p50</th><th>p90</th><th>avg face sim</th></tr>",
        summary("keyframe", kf, scores["kf"]),
        summary("shot", shots, scores["shots"]),
        "</table><p>Summary shows real model names; the sections below are blind (M1, M2…). Key: blind-key.json.</p>",
    ]
    for p in pairs:
        pid = p["id"]
        kf_items = [e for e in scores["kf"] if e["pair"] == pid]
        clips = sorted((run_dir / "stitched").glob(f"*/{pid}.mp4")) if (run_dir / "stitched").exists() else []
        if not kf_items and not clips:
            continue
        body.append(f'<h2>{pid}</h2><div class="src"><img src="{rel(run_dir, EVAL / "data" / p["survivor"])}"><img src="{rel(run_dir, EVAL / "data" / p["infected"])}"></div>')
        for frame in ("A", "B", "C"):
            items = [e for e in kf_items if e["frame"] == frame]
            if not items:
                continue
            rng.shuffle(items)
            cells = "".join(
                f'<figure><img src="{rel(run_dir, e["path"])}"><figcaption>{blind[e["model"]]} #{e["cand"]}</figcaption>'
                f'{rating(f"{pid}-{frame}-{blind[e["model"]]}-{e["cand"]}")}</figure>'
                for e in items
            )
            body.append(f"<h3>Keyframe {frame}</h3><div class=grid>{cells}</div>")
        if clips:
            rng.shuffle(clips)
            cells = "".join(
                f'<figure><video src="{rel(run_dir, c)}" controls loop playsinline></video><figcaption>{blind.get(c.parent.name, c.parent.name)}</figcaption>'
                f'{rating(f"{pid}-video-{blind.get(c.parent.name, c.parent.name)}")}</figure>'
                for c in clips
            )
            body.append(f"<h3>Videos</h3><div class=grid>{cells}</div>")

    page = f"""<!doctype html><meta charset=utf-8><title>Eval {html.escape(run_dir.name)}</title>
<style>body{{font:14px system-ui;margin:16px;background:#111;color:#eee}}table{{border-collapse:collapse}}td,th{{border:1px solid #444;padding:4px 8px}}
.grid{{display:flex;flex-wrap:wrap;gap:12px}}figure{{margin:0;width:220px}}img,video{{width:220px;border-radius:6px}}.src img{{width:120px;margin-right:8px}}
.rate label{{margin-right:6px}}button{{position:fixed;top:12px;right:12px;padding:8px 14px}}</style>
<button id=export>Export ratings.json</button>
{''.join(body)}
<script>
const KEY = "vzc-ratings-{html.escape(run_dir.name)}";
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch (e) {{}}
for (const el of document.querySelectorAll("input")) {{
  const v = saved[el.name];
  if (el.type === "radio" && v === el.value) el.checked = true;
  if (el.type === "checkbox" && v === true) el.checked = true;
  el.addEventListener("change", () => {{
    saved[el.name] = el.type === "checkbox" ? el.checked : el.value;
    try {{ localStorage.setItem(KEY, JSON.stringify(saved)); }} catch (e) {{}}
  }});
}}
document.getElementById("export").onclick = () => {{
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 1)], {{ type: "application/json" }}));
  a.download = "ratings.json";
  a.click();
}};
</script>"""
    (run_dir / "review.html").write_text(page)
    print(f"wrote {run_dir / 'review.html'}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run eval/scripts/report.py eval/results/<run>")
    main(Path(sys.argv[1]).resolve())
```

- [ ] **Step 3: 自检——空运行目录能生成页面**

Run:
```bash
mkdir -p eval/results/selfcheck
[ -f eval/data/pairs.json ] || echo '[]' > eval/data/pairs.json
uv run eval/scripts/report.py eval/results/selfcheck
```
Expected: `wrote .../eval/results/selfcheck/review.html`，页面只有空汇总表，不报错

- [ ] **Step 4: 清理并提交**

```bash
rm -rf eval/results/selfcheck
git add eval/scripts/stitch.py eval/scripts/report.py
git commit -m "feat(eval): shot stitching and blind review page"
```

---

### Task 10: 第一轮评测——关键帧

**Files:**
- 无代码改动；产物在 `eval/results/r1/`（不提交）

**Interfaces:**
- Consumes: Task 1–9 的全部脚本

每一步花钱前，先把干跑打印的预估给用户看，得到同意后再加 `--yes`。

- [ ] **Step 1: 确认 key 与余额（不打印 key）**

Run: `set -a && . ~/.vzc-secrets/eval.env && set +a && curl -s -H "Authorization: Bearer $KIE_API_KEY" https://api.kie.ai/api/v1/chat/credit`
Expected: `{"code":200,"msg":"success","data":<余额>}`，余额 ≥ 4000 积分（$20）

- [ ] **Step 2: 生成合成人物（约 $0.6）**

Run: `node eval/src/run-personas.ts`，把预估给用户确认后 `node eval/src/run-personas.ts --yes`
Expected: 24 个 ✓，`eval/data/pairs.json` 写入 12 组。逐张打开 `eval/data/personas/` 检查：每张单人（或单只动物）、正脸清晰；不合格的删掉对应行重跑（删除 `eval/data/personas/results.jsonl` 里那一行即可重做）。

- [ ] **Step 3: 关键帧 A / C（10 组 × 5 模型 × 2 帧 × 2 候选 = 200 张，预估约 $6.5）**

Run: `node eval/src/run-keyframes.ts --run r1 --stage AC`，确认预估后加 `--yes`
Expected: 结束行 `done: N ok, M failed`；失败的重跑同一条命令即可续跑

- [ ] **Step 4: 打分并挑最佳 A / C**

Run: `uv run eval/scripts/face_score.py eval/results/r1`
Expected: `scored ~200 keyframes`；`eval/results/r1/picks.json` 每组每模型都有 A 和 C

- [ ] **Step 5: 关键帧 B（10 组 × 5 模型 = 50 张，预估约 $1.6）**

Run: `node eval/src/run-keyframes.ts --run r1 --stage B`，确认后加 `--yes`；然后再跑一次 `uv run eval/scripts/face_score.py eval/results/r1`
Expected: picks.json 每组每模型补上 B

- [ ] **Step 6: 盲评关键帧**

Run: `uv run eval/scripts/report.py eval/results/r1 && open eval/results/r1/review.html`
Expected: 用户盲评打分并导出 `ratings.json` 放到 `eval/results/r1/`。按 README 的判定规则选出关键帧默认模型和备用模型（下一步用 `--kf-model` 指定默认模型）。

---

### Task 11: 第二轮评测——镜头，并写下结论

**Files:**
- Create: `docs/model-eval.md`
- Modify: `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md`（§5.1 镜头 2、§10 结论链接）

**Interfaces:**
- Consumes: Task 10 选出的关键帧模型 key（下文以 `<kf>` 表示，例如 `nb2`）

- [ ] **Step 1: 镜头（2 组 × 5 模型 × 4 镜头，预估约 $8）**

挑 2 组差异最大的（建议 `p07` 光头、`p06` 头巾）。
Run: `node eval/src/run-shots.ts --run r1 --kf-model <kf> --pairs p06,p07`，确认预估后加 `--yes`
Expected: 40 个任务；失败重跑续跑

- [ ] **Step 2: 打分、拼接、盲评**

Run:
```bash
uv run eval/scripts/face_score.py eval/results/r1
uv run eval/scripts/stitch.py eval/results/r1
uv run eval/scripts/report.py eval/results/r1 && open eval/results/r1/review.html
```
Expected: 每个视频模型 2 条拼接成片；用户盲评后导出 ratings.json

- [ ] **Step 3: 复跑 1–2 个最佳视频模型到全部 10 组（新一轮 r2，预估 ≤ $10）**

Run: `node eval/src/run-shots.ts --run r2 --kf-model <kf> --models <最佳1>,<最佳2>` ——先把 r1 的 `picks.json` 复制到 `eval/results/r2/`；确认预估后加 `--yes`，再跑打分、拼接、盲评
Expected: 拿到 10 组的成功率、p90 耗时、单条成本

- [ ] **Step 4: 写 `docs/model-eval.md`**

按以下结构写结论（数字全部来自 `review.html` 汇总表和 ratings.json，不手估）：

```markdown
# 模型评测结论（2026-10-xx，评测轮次 r1 / r2）

## 关键帧
| 角色 | 模型 | 成功率 | p90 耗时 | 单张成本 | 平均人脸相似度 | 盲评均分 |
默认：…；备用：…；理由：…

## 镜头
| 角色 | 模型 | 成功率 | p90 耗时 | 4 镜头合计成本 | 平均人脸相似度 | 盲评均分 |
默认：…；备用：…；首尾帧（镜头 3）效果：…

## 成本
- 单次免费预览（A、C 各 2 候选）：$…
- 单条付费视频（B + 4 镜头，不含预览）：$…
- 建议：积分 N = …；免费预览每日上限 …；定价是否需要上调（毛利 ≥70% 的门槛）：…

## 提示词改动
- …

## 失败与一票否决记录
- …
```

- [ ] **Step 5: 回写规格**

在 `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md`：
- §5.1 镜头 2 改为「握枪的手特写，手指离开扳机（宠物版：手放低手电筒）」，并注明原因（A 帧里幸存者是背侧位）。
- §5.1 表下加一句：各模型最短时长不足时向上取整生成，合成时剪到目标时长。
- §10 末尾加：「结论见 `docs/model-eval.md`」。

- [ ] **Step 6: Commit**

```bash
git add docs/model-eval.md docs/superpowers/specs/2026-10-14-videozombiecouple-design.md
git commit -m "docs: model eval results and storyboard adjustments"
```
