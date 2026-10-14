# 后端与生成流水线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 unblurpix 复制出 API 与共享包，把「单图修复任务」换成「丧尸情侣故事」：免费关键帧预览（quota）→ 付费生成 4 镜头视频（积分）→ composer 容器打分与 ffmpeg 合成，测试全绿、wrangler dry-run 通过。

**Architecture:** pnpm monorepo。`packages/catalog` 新增故事数据（场景、分镜、提示词、积分、次数包），`packages/providers` 的 kie 适配器按模型族映射图像编辑与图生视频入参，`apps/api` 用新的 `StoryRunner` Durable Object 按「步骤图」推进（每步 = 一次 kie 调用带路由回退，或一次 composer 调用），沿用 Dispatcher（并发与熔断）、Wallet（积分）、RateLimiter（免费额度）、Waffo、登录、风控。`apps/composer` 是 Cloudflare Container（Python + ffmpeg + insightface），只通过预签名 URL 读写 R2，无状态。

**Tech Stack:** Node 24、pnpm 10、TypeScript、Hono on Workers、D1 / R2 / KV / Durable Objects、`@cloudflare/containers`、Vitest（内存版 harness）、Python 3.12 + FastAPI + insightface + ffmpeg、Docker。

**Spec:** `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md`（§3 架构、§4 生成流程、§5 分镜、§7 计费、§8 风控运维）。模型结论：`docs/model-eval.md`（第 1 份计划 Task 11 产出；本计划 Task 4 的路由种子以它为准）。

## Global Constraints

- 复制来源：`/Users/lwx/Workspace/opc/unblurpix`（只读，不改它）。包名 `@unblurpix/*` → `@vzc/*`；资源名前缀 `vzc-`；域名 `videozombiecouple.com`、`api.`、`staging.`、`api-staging.`。
- KIE 密钥只在 `~/.vzc-secrets/` 与 wrangler secret；绝不打印、写日志或提交。读页面或日志的脚本要屏蔽 16 位以上的串。
- 页面与接口里的数字（价格、积分、额度、时长）只从 `packages/catalog` 读。
- 先写失败的测试，再写实现；每个任务结束 `pnpm -r test` 全绿、`pnpm typecheck` 通过、`pnpm lint` 通过。
- 同一镜头不出现健康脸与丧尸脸同框；宠物版宠物只能是变丧尸的一方。
- 积分在视频阶段开始时预扣，成片未交付则全额退还；免费预览需登录，每天 3 次（`QUOTA.previewUserDaily`）。
- 人脸特征只在 composer 内存中计算，不落库、不写日志。
- R2 保留期：`in/` 1 天、`kf/` 3 天、`shot/` 3 天、`out/` 14 天。
- 输出 9:16、720×1280、24fps、H.264、AAC；成片总长 12 秒（4 镜头 11 秒 + 1 秒字幕卡）。
- 不使用原爆款视频的画面与音乐；配乐是本站自有音轨（Task 9 生成并记录许可）。

## Review Focus

1. **kie 任务回调早于状态写入 / 回调重复 / 回调迟到**：StoryRunner 只把回调当作「立刻轮询」信号，重复和迟到无副作用。→ Task 7 测试 `poke is idempotent`.
2. **视频阶段某个镜头所有路由都失败**：整条视频失败、积分全额退还、已成功镜头不再扣费，用户看到明确错误码。→ Task 7 测试 `shot exhausts routes → refund`.
3. **composer 不可用（冷启动超时、5xx）**：打分 / 合成步骤按退避重试，不重新生成已有镜头；超过重试上限才失败并退款。→ Task 7 测试 `compose retries then refunds`.
4. **同一用户并发点两次「生成视频」**：只扣一次积分（幂等键 + runner 状态检查）。→ Task 8 测试 `render twice charges once`.
5. **上传照片不是本人会话上传的、或不是 JPEG、或太小**：拒绝建故事，不占免费额度。→ Task 8 测试 `foreign upload rejected without quota`.

---

## File Structure

| 路径 | 职责 |
|---|---|
| `package.json`、`pnpm-workspace.yaml`、`biome.json`、`tsconfig.base.json` | monorepo 根（从 unblurpix 复制改名） |
| `packages/catalog/src/story.ts` | 场景、分镜、提示词组装、宠物词表 |
| `packages/catalog/src/capabilities.ts` | 能力：`keyframe`、`shot`（替换 `unblur.*`） |
| `packages/catalog/src/routes.ts` | kie 路由种子（按评测结论） |
| `packages/catalog/src/pricing.ts`、`plans.ts`、`tiers.ts`、`limits.ts` | 每条视频积分、次数包、免费预览额度、保留期 |
| `packages/contracts/src/stories.ts` | `CreateStorySchema`、`RenderSchema`、`RecomposeSchema`、`StoryView` |
| `packages/contracts/src/errors.ts` | 新增错误码 |
| `packages/providers/src/kie.ts` | `buildKieInput` 按模型族映射；`JobInput` 改为 `TaskInput` |
| `apps/api/src/stories/graph.ts` | 纯函数：步骤图规划、就绪步骤、阶段结果 |
| `apps/api/src/stories/types.ts` | `StorySpec`、`StepRecord`、`StoryState`、`StoryView` |
| `apps/api/src/durable-objects/story-runner.ts` | 推进步骤图、调用 kie / composer、结算 |
| `apps/api/src/services/composer.ts` | composer 客户端（容器绑定或本地 URL / 假实现） |
| `apps/api/src/routes/stories.ts` | `POST /v1/stories`、`GET /v1/stories/:id`、`POST /v1/stories/:id/render`、`POST /v1/stories/:id/recompose` |
| `apps/api/migrations/0006_stories.sql` | `stories` 表 |
| `apps/composer/` | Dockerfile、`app.py`、`grade.py`、`score.py`、`tests/` |
| `apps/api/src/composer-container.ts` | `Composer` Container 类 |
| `assets/music/` | 场景配乐与许可记录 |

---

### Task 1: 复制 unblurpix 骨架并改名

**Files:**
- Create（复制）：根配置、`packages/*`、`apps/api/*`、`scripts/*`、`infra/*`、`.github/workflows/*`、`docs/lessons.md`、`docs/runbooks/*`
- Modify：所有 `@unblurpix/` 引用、`unblurpix` 资源名与域名、`CLAUDE.md`

**Interfaces:**
- Produces：包名 `@vzc/catalog`、`@vzc/contracts`、`@vzc/providers`、`@vzc/i18n`；API 包 `@vzc/api`

- [ ] **Step 1: 复制（不含 web、eval、node_modules、.git、产物）**

```bash
SRC=/Users/lwx/Workspace/opc/unblurpix
rsync -a --exclude node_modules --exclude .wrangler --exclude dist --exclude coverage \
  --exclude .astro --exclude test-results --exclude playwright-report \
  $SRC/package.json $SRC/pnpm-workspace.yaml $SRC/biome.json $SRC/tsconfig.base.json \
  $SRC/packages $SRC/scripts $SRC/infra $SRC/.github ./
mkdir -p apps docs/runbooks
rsync -a --exclude node_modules --exclude .wrangler $SRC/apps/api apps/
cp $SRC/docs/lessons.md docs/lessons.md
cp -R $SRC/docs/runbooks/. docs/runbooks/
```

- [ ] **Step 2: 合并 .gitignore**（保留本仓库已有的 eval 规则，追加 unblurpix 的构建产物规则）

```bash
cat >> .gitignore <<'EOF'
dist/
.wrangler/
.astro/
coverage/
test-results/
playwright-report/
.dev.vars
apps/web/public/vendor/
EOF
```

- [ ] **Step 3: 批量改名**

```bash
grep -rlE "unblurpix|UnblurPix|Unblurpix" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=eval --exclude-dir=docs/superpowers . \
  | xargs sed -i '' -e 's/@unblurpix\//@vzc\//g' -e 's/unblurpix\.com/videozombiecouple.com/g' \
     -e 's/unblurpix-/vzc-/g' -e 's/unblurpix_/vzc_/g' -e 's/UnblurPix/VideoZombieCouple/g' -e 's/unblurpix/vzc/g'
grep -rnE "unblurpix|UnblurPix" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=eval --exclude-dir=superpowers . | head
```
Expected: 最后的 grep 无输出（`docs/superpowers` 与 `eval` 本就不含 unblurpix 引用）。

- [ ] **Step 4: 清掉 unblurpix 的账号 ID**

`apps/api/wrangler.jsonc`、`apps/api/wrangler.production.jsonc` 中：KV / D1 的 `id`、`database_id` 改为 `"REPLACE_BY_SETUP"`；`R2_ACCOUNT_ID`、`GOOGLE_CLIENT_ID`、`WAFFO_MERCHANT_ID`、`WAFFO_STORE_ID` 改为 `""`；`WAFFO_PRODUCTS` 改为 `"{}"`；`analytics_engine_datasets` 改名 `vzc_staging_attempts` / `vzc_attempts`。`.github/workflows/*` 里的 GitHub 环境变量名保持不变（部署计划再配）。

- [ ] **Step 5: 去掉 web 相关的 CI 步骤**

`.github/workflows/ci.yml`、`deploy.yml` 中所有 `--filter @vzc/web`、Playwright、Lighthouse、size 步骤先删掉（第 3 份计划把站点加回来）。`pnpm-workspace.yaml` 保留 `apps/*`、`packages/*`。

- [ ] **Step 6: 写本仓库的 `CLAUDE.md`**

```markdown
# VideoZombieCouple

设计以 `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md` 为准；实施计划在 `docs/superpowers/plans/`；模型结论在 `docs/model-eval.md`。踩过的坑在 `docs/lessons.md`（继承自 UnblurPix），动手前先看相关章节，解决新坑后补进去。

## 命令
- `pnpm install`、`pnpm lint`（`pnpm format` 自动修）、`pnpm typecheck`、`pnpm test`
- 单个包：`pnpm --filter @vzc/catalog test`
- API 打包检查：`pnpm --filter @vzc/api dryrun`
- composer：`cd apps/composer && uv run pytest`；镜像：`docker build -t vzc-composer apps/composer`
- 评测：见 `eval/README.md`（不进 workspace，不进 CI）

## 硬性规则
- 先写失败的测试，再写实现。
- 页面与接口里的数字只从 `packages/catalog` 读。
- 改提示词或模型路由之前，用 `eval/` 跑受影响的模型，每轮预算 ≤ $10。
- KIE 密钥只在 `~/.vzc-secrets/` 和 wrangler secret 里；绝不打印、写日志或提交。
- 人脸特征只在 composer 内存中计算，不落库、不写日志。
- 与 UnblurPix、video2mp4 的收款、广告、统计账号完全隔离；登录任何收款后台先确认商户属于 VideoZombieCouple。
```

- [ ] **Step 7: 安装并跑测试**

Run: `pnpm install && pnpm -r test > /tmp/vzc-t1.log 2>&1; tail -20 /tmp/vzc-t1.log`
Expected: 安装成功；测试全绿（此时代码仍是 unblurpix 的图像逻辑，只改了名字）。失败的只可能是含旧名字的断言（如 `configs.test.ts` 检查 wrangler 名称）——按新名字改断言。

- [ ] **Step 8: Commit**

```bash
git add -A ':!eval/results' ':!eval/data'
git commit -m "chore: bootstrap api and packages from UnblurPix, renamed to vzc"
```

---

### Task 2: catalog —— 故事数据、能力、计费

**Files:**
- Create: `packages/catalog/src/story.ts`、`packages/catalog/test/story.test.ts`
- Modify: `packages/catalog/src/capabilities.ts`、`tiers.ts`、`plans.ts`、`pricing.ts`、`limits.ts`、`modes.ts`、`index.ts`
- Delete: `packages/catalog/src/editor.ts`、`tools.ts`、`facts.ts` 及其测试（图片工具专用）；`pages.ts` 先保留（第 3 份计划重写）

**Interfaces:**
- Produces:
  - `KINDS = ["human","pet"] as const; type Kind`
  - `SCENE_IDS = ["cabin-wheat","rain-chapel","lighthouse-beach"] as const; type SceneId`
  - `SCENES: Record<SceneId, Scene>`，`Scene = { id; label; live: boolean; cold: string; warm: string; musicKey: string }`
  - `type FrameId = "A" | "B" | "C"`；`REQUIRED_FACES: Record<FrameId, ("survivor"|"infected")[]>`
  - `type ShotId = 1|2|3|4`；`STORYBOARD: { id: ShotId; targetSec: number; first: FrameId; last?: FrameId; faces: ("survivor"|"infected")[] }[]`
  - `keyframePrompt(scene: SceneId, frame: FrameId, kind: Kind): string`
  - `shotPrompt(scene: SceneId, shot: ShotId, kind: Kind): string`
  - `CANDIDATES_PER_FRAME = 2`；`CAPTION_SEC = 1`；`VIDEO = { width: 720, height: 1280, fps: 24 }`
  - `CAPABILITY_IDS = ["keyframe","shot"] as const`；`Capability = { id; pool: "kie-image"|"kie-video"; p50Ms: number }`
  - `TIER_IDS = ["preview","video"]`；`TIERS.video.credits = VIDEO_CREDITS`（= 10）
  - `PACKS`: `pack1`（10 积分，$4.99）、`pack3`（30，$11.99，popular）、`pack10`（100，$29.99）；`PLANS` 保留类型但 `SELL_PLANS = false`，`PRODUCTS` 只含次数包
  - `QUOTA = { previewUserDaily: 3, previewIpSegmentDaily: 10 }`；`RETENTION = { inputHours: 24, workDays: 3, outputDays: 14, signedUrlSeconds: 3600 }`
  - `MODES` 改为 `Record<Kind, { promptVersion: string }>`（planRoutes 的 mode 参数即 kind）

积分换算：1 条视频 = 10 积分，对用户展示为「1 video」。评测后若单条成本使毛利 < 70%，只改 `PACKS` 价格，不改积分换算。

- [ ] **Step 1: 写失败的测试 `packages/catalog/test/story.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  KINDS,
  PACKS,
  PRODUCTS,
  SCENE_IDS,
  SCENES,
  STORYBOARD,
  TIERS,
  keyframePrompt,
  shotPrompt,
} from "../src/index.ts";

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";

describe("story catalog", () => {
  it("storyboard plus caption is 12 seconds and shot 3 runs A→B", () => {
    expect(STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC).toBe(12);
    expect(STORYBOARD.find((s) => s.id === 3)).toMatchObject({ first: "A", last: "B" });
  });

  it("every prompt carries the safety line for every scene and kind", () => {
    for (const scene of SCENE_IDS)
      for (const kind of KINDS) {
        for (const f of ["A", "B", "C"] as const) expect(keyframePrompt(scene, f, kind)).toContain(SAFE);
        for (const s of STORYBOARD) expect(shotPrompt(scene, s.id, kind)).toContain(SAFE);
      }
  });

  it("pet prompts never mention a gun", () => {
    for (const scene of SCENE_IDS) {
      for (const f of ["A", "B", "C"] as const) expect(keyframePrompt(scene, f, "pet")).not.toMatch(/pistol|\bgun\b/i);
      for (const s of STORYBOARD) expect(shotPrompt(scene, s.id, "pet")).not.toMatch(/pistol|\bgun\b/i);
    }
  });

  it("scenes swap the setting, not the story", () => {
    expect(keyframePrompt("rain-chapel", "A", "human")).not.toBe(keyframePrompt("cabin-wheat", "A", "human"));
    expect(SCENES["cabin-wheat"].live).toBe(true);
  });

  it("only video packs are sold, and a video costs 10 credits", () => {
    expect(TIERS.video.credits).toBe(10);
    expect(PACKS.map((p) => [p.id, p.credits, p.usd])).toEqual([
      ["pack1", 10, 4.99],
      ["pack3", 30, 11.99],
      ["pack10", 100, 29.99],
    ]);
    expect(PRODUCTS.every((p) => p.kind === "pack")).toBe(true);
    expect(CANDIDATES_PER_FRAME).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vzc/catalog test -- story`
Expected: FAIL（`keyframePrompt` 等未导出）

- [ ] **Step 3: 写 `packages/catalog/src/story.ts`**

把第 1 份计划 `eval/src/storyboard.ts` 的提示词迁移过来，按评测 Task 11 的「提示词改动」更新，并把场景参数化：

```ts
// The zombie love story (spec §5). Keyframe prompts are image-edit instructions over the two photos;
// shot prompts animate one keyframe each. Change only together with an eval run (CLAUDE.md).
export const KINDS = ["human", "pet"] as const;
export type Kind = (typeof KINDS)[number];

export const SCENE_IDS = ["cabin-wheat", "rain-chapel", "lighthouse-beach"] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export type Scene = {
  id: SceneId;
  label: string;
  /** Shown in the picker once its prompts passed the eval (spec §9). */
  live: boolean;
  /** Setting of the standoff (keyframes A, B; shots 1–3). */
  cold: string;
  /** Setting of the memory (keyframe C; shot 4). */
  warm: string;
  musicKey: string;
};

export const SCENES: Record<SceneId, Scene> = {
  "cabin-wheat": {
    id: "cabin-wheat",
    label: "Cabin → Wheat field",
    live: true,
    cold: "Inside a dim abandoned wooden cabin, cold blue moonlight through broken boards, dust in the air, 35mm film grain.",
    warm: "Golden wheat field at sunset, warm backlight, lens flare, soft haze, 35mm film grain.",
    musicKey: "music/cabin-wheat.m4a",
  },
  "rain-chapel": {
    id: "rain-chapel",
    label: "Rainy city → Chapel",
    live: false,
    cold: "Abandoned city street at night in heavy rain, wet asphalt reflecting cold blue streetlight, overturned cars, 35mm film grain.",
    warm: "Small sunlit wooden chapel decorated with white flowers, warm afternoon light through tall windows, 35mm film grain.",
    musicKey: "music/rain-chapel.m4a",
  },
  "lighthouse-beach": {
    id: "lighthouse-beach",
    label: "Lighthouse → Beach",
    live: false,
    cold: "Inside a ruined lighthouse at dusk, cold blue light, storm clouds through broken windows, 35mm film grain.",
    warm: "Sandy beach at golden hour, gentle waves, warm sunset glow, soft haze, 35mm film grain.",
    musicKey: "music/lighthouse-beach.m4a",
  },
};

export type FrameId = "A" | "B" | "C";
export type Face = "survivor" | "infected";
export type ShotId = 1 | 2 | 3 | 4;

export const REQUIRED_FACES: Record<FrameId, Face[]> = {
  A: ["infected"],
  B: ["survivor", "infected"],
  C: ["survivor", "infected"],
};

export const STORYBOARD: { id: ShotId; targetSec: number; first: FrameId; last?: FrameId; faces: Face[] }[] = [
  { id: 1, targetSec: 3, first: "A", faces: ["infected"] },
  { id: 2, targetSec: 2.5, first: "A", faces: [] },
  { id: 3, targetSec: 2.5, first: "A", last: "B", faces: ["survivor", "infected"] },
  { id: 4, targetSec: 3, first: "C", faces: ["survivor", "infected"] },
];

export const CANDIDATES_PER_FRAME = 2;
export const CAPTION_SEC = 1;
export const VIDEO = { width: 720, height: 1280, fps: 24 } as const;

const SAFE = "No blood, no gore, no biting, no gunfire, no text.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";

function words(kind: Kind) {
  return kind === "human"
    ? {
        holds: "aiming a pistol",
        lowers: "slowly lowers the pistol, lets it fall",
        hands: "the survivor's hands on the pistol; the hands tremble and the index finger slides off the trigger",
        other: "infected partner",
        infected: "infected: pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing",
        healthy: "Both people healthy and smiling, clean casual clothes",
        subject2: "Person from IMAGE 2",
      }
    : {
        holds: "kneeling and holding a flashlight",
        lowers: "slowly sets the flashlight down",
        hands: "the survivor's hand on the flashlight; the hand trembles and slowly lowers the beam",
        other: "infected pet",
        infected: "infected: cloudy white eyes, patchy fur",
        healthy: "The person and the pet are healthy and happy",
        subject2: "The pet from IMAGE 2",
      };
}

export function keyframePrompt(sceneId: SceneId, frame: FrameId, kind: Kind): string {
  const scene = SCENES[sceneId];
  const w = words(kind);
  if (frame === "A")
    return [
      "Cinematic film still, vertical 9:16.",
      scene.cold,
      `Person from IMAGE 1 stands in the foreground, back three-quarter view, ${w.holds}, wearing a worn olive jacket.`,
      `${w.subject2} faces the camera from the far side of the room, backlit, ${w.infected} — but clearly recognizable as IMAGE 2: same face shape, features and hair or fur.`,
      "IMAGE 1 is the survivor and IMAGE 2 is the one who turned; never swap them. Keep both identities exact.",
      SAFE,
    ].join(" ");
  if (frame === "C")
    return [
      "Cinematic film still, vertical 9:16.",
      scene.warm,
      `${w.healthy}, embracing, front three-quarter view.`,
      "Person from IMAGE 1 and the subject from IMAGE 2, identities exact.",
      SAFE,
    ].join(" ");
  return [
    "Cinematic film still, vertical 9:16.",
    "IMAGE 1 is the survivor. IMAGE 2 is the one who turned. IMAGE 3 is the scene reference. IMAGE 4 is the pose reference.",
    "Use exactly the same pose, framing and camera angle as IMAGE 4.",
    "Use the setting, lighting and the infected look from IMAGE 3.",
    `Person from IMAGE 1 embraces the ${w.other} from IMAGE 2, identities exact.`,
    SAFE,
  ].join(" ");
}

export function shotPrompt(_sceneId: SceneId, shot: ShotId, kind: Kind): string {
  const w = words(kind);
  const body = {
    1: `Slow push-in from behind the survivor's shoulder. The survivor keeps ${w.holds}, trembling slightly. The ${w.other} slowly turns its head toward camera. Dust particles drift in the cold light. No lunging, no camera shake.`,
    2: `Slow push-in to a close-up of ${w.hands}. Shallow depth of field, cold blue light.`,
    3: `The survivor ${w.lowers}, and opens both arms. The ${w.other} steps forward into the embrace; they hold each other tightly. Slow orbit camera. Emotional, gentle.`,
    4: "Slow-motion pull back. They laugh while hugging, wind moves their hair. Golden hour sunlight, warm glow. Natural, joyful motion.",
  }[shot];
  return `${body} ${MOTION} ${SAFE}`;
}
```

（若评测 Task 11 改了提示词措辞，以 `docs/model-eval.md`「提示词改动」为准替换上面的句子，测试不变。）

- [ ] **Step 4: 改 capabilities / tiers / plans / pricing / limits / modes**

```ts
// capabilities.ts
export const CAPABILITY_IDS = ["keyframe", "shot"] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];
export type Capability = { id: CapabilityId; pool: "kie-image" | "kie-video"; p50Ms: number };
/** p50 from docs/model-eval.md (default routes). */
export const CAPABILITIES: Record<CapabilityId, Capability> = {
  keyframe: { id: "keyframe", pool: "kie-image", p50Ms: 30_000 },
  shot: { id: "shot", pool: "kie-video", p50Ms: 90_000 },
};
```

```ts
// tiers.ts
export const TIER_IDS = ["preview", "video"] as const;
export type TierId = (typeof TIER_IDS)[number];
export type Tier = { id: TierId; label: string; credits: number };
export const VIDEO_CREDITS = 10;
/** Spec §7: a preview is free (daily quota); a finished video costs VIDEO_CREDITS. */
export const TIERS: Record<TierId, Tier> = {
  preview: { id: "preview", label: "Preview", credits: 0 },
  video: { id: "video", label: "Video", credits: VIDEO_CREDITS },
};
```

`plans.ts`：`PACKS` 换成上面三个次数包；`PRODUCTS` 只由 `PACKS` 生成；`PLANS`、`PLAN_IDS`、`PERKS` 保留（billing 代码依赖其类型）但新增 `export const SELL_PLANS = false`，`BONUSES = { signup: 0, referral: 0 }`。

`limits.ts`：`QUOTA` 改为 `{ previewUserDaily: 3, previewIpSegmentDaily: 10 }`；`RETENTION` 改为 `{ inputHours: 24, workDays: 3, outputDays: 14, signedUrlSeconds: 3600 }`；`FILE_LIMITS.minShortEdge` 改为 `384`（人脸要够大）；其余（RATE_LIMITS、DISPATCH 等）保留。

`modes.ts`：

```ts
import type { Kind } from "./story.ts";
export type ModeId = Kind;
export const MODES: Record<ModeId, { promptVersion: string }> = {
  human: { promptVersion: "h1" },
  pet: { promptVersion: "p1" },
};
```

`index.ts`：去掉 `editor`、`facts`、`tools` 的导出，加 `export * from "./story.ts";`。

- [ ] **Step 5: 跑 catalog 测试并修复连带测试**

Run: `pnpm --filter @vzc/catalog test`
Expected: `story.test.ts` PASS。删除只测图片工具的测试文件（`editor.test.ts`、`tools.test.ts`、`facts.test.ts`）；`pricing.test.ts`、`routes.test.ts`、`build.test.ts` 按新的 PACKS / 能力改断言（不删测试意图：价格单调、每个 product 有 key、路由每个能力至少一个 rank 1）。

- [ ] **Step 6: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): story scenes, storyboard, prompts, video credits and packs"
```

---

### Task 3: providers —— 按模型族映射 kie 入参

**Files:**
- Modify: `packages/providers/src/types.ts`、`kie.ts`、`fake.ts`、`select.ts`
- Test: `packages/providers/test/kie.test.ts`（改）、`packages/providers/test/input.test.ts`（新）

**Interfaces:**
- Consumes: `RouteSeed`（Task 4 改字段）
- Produces:
  - `type TaskInput = { prompt: string; images: string[]; first?: string; last?: string; seconds?: number; aspect: string }`
  - `buildKieInput(route: RouteSeed, input: TaskInput): Record<string, unknown>`
  - `ProviderAdapter.submit(route, input: TaskInput, callbackUrl)`（其余签名不变）
  - `padAspects`、`chargeTier` 删除；`planRoutes(routes, capability, mode)` 保留

映射规则（字段名来自 2026-10-14 拉取的 kie schema，与 `eval/src/candidates.ts` 一致）：

| 模型前缀 | 入参 |
|---|---|
| `nano-banana` | `{ prompt, image_input: images, aspect_ratio, ...params }` |
| `seedream/` | `{ prompt, image_urls: images, aspect_ratio, ...params }` |
| `gpt-image-2` / `flux-2/` | `{ prompt, input_urls: images, aspect_ratio, ...params }` |
| `bytedance/seedance-2` | `{ prompt, first_frame_url: first, last_frame_url?: last, aspect_ratio, duration: seconds, generate_audio: false, ...params }` |
| `kling-3.0/video` | `{ prompt, image_urls: last ? [first,last] : [first], sound: false, duration: String(seconds), multi_shots: false, ...params }` |
| `veo-3-1` | `{ prompt, generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO", image_urls: last ? [first,last] : [first], aspect_ratio, duration: seconds, ...params }` |
| `wan/2-7-image-to-video` | `{ prompt, first_frame_url: first, last_frame_url?: last, duration: seconds, prompt_extend: false, ...params }` |

视频路由的 `seconds` 由 runner 用 `pickSeconds(route, targetSec)` 算（规则同评测：向上取整到 `route.minSec`，有 `allowedSec` 时取第一个 ≥ 的值）。

- [ ] **Step 1: 写失败的测试 `packages/providers/test/input.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildKieInput, pickSeconds } from "../src/index.ts";
import { route } from "./route-fixture.ts";

describe("buildKieInput", () => {
  it("image edit models get all reference images under their own field", () => {
    const images = ["s", "i", "a", "c"];
    expect(buildKieInput(route("nano-banana-2"), { prompt: "p", images, aspect: "9:16" })).toMatchObject({ image_input: images, aspect_ratio: "9:16" });
    expect(buildKieInput(route("seedream/5-pro-image-to-image"), { prompt: "p", images, aspect: "9:16" })).toMatchObject({ image_urls: images });
    expect(buildKieInput(route("gpt-image-2-image-to-image"), { prompt: "p", images, aspect: "9:16" })).toMatchObject({ input_urls: images });
  });

  it("seedance uses first/last frame, no audio, integer seconds", () => {
    expect(
      buildKieInput(route("bytedance/seedance-2-mini", { params: { resolution: "720p" } }), { prompt: "p", images: [], first: "f", last: "l", seconds: 4, aspect: "9:16" }),
    ).toEqual({ prompt: "p", first_frame_url: "f", last_frame_url: "l", aspect_ratio: "9:16", duration: 4, generate_audio: false, resolution: "720p" });
  });

  it("first-frame-only shots omit last frame", () => {
    const out = buildKieInput(route("bytedance/seedance-2-fast"), { prompt: "p", images: [], first: "f", seconds: 4, aspect: "9:16" });
    expect("last_frame_url" in out).toBe(false);
    expect(buildKieInput(route("kling-3.0/video"), { prompt: "p", images: [], first: "f", seconds: 3, aspect: "9:16" })).toMatchObject({ image_urls: ["f"], duration: "3", sound: false });
  });

  it("video routes without a first frame are invalid", () => {
    expect(() => buildKieInput(route("bytedance/seedance-2-mini"), { prompt: "p", images: [], seconds: 4, aspect: "9:16" })).toThrow(/first frame/);
  });

  it("pickSeconds rounds up to the route minimum and allowed values", () => {
    expect(pickSeconds(route("bytedance/seedance-2-mini", { minSec: 4, maxSec: 15 }), 2.5)).toBe(4);
    expect(pickSeconds(route("veo-3-1", { minSec: 4, maxSec: 8, allowedSec: [4, 6, 8] }), 5)).toBe(6);
  });
});
```

`packages/providers/test/route-fixture.ts`：

```ts
import type { RouteSeed } from "@vzc/catalog";
export function route(model: string, over: Partial<RouteSeed> = {}): RouteSeed {
  return {
    id: `t:${model}`,
    capability: model.includes("video") || model.includes("seedance") || model.startsWith("veo") || model.startsWith("wan/") ? "shot" : "keyframe",
    mode: null,
    rank: 1,
    parallel: false,
    provider: "kie",
    model,
    params: {},
    timeoutMs: 60_000,
    aspects: ["9:16"],
    costUsd: 0.1,
    label: model,
    ...over,
  };
}
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vzc/providers test -- input`
Expected: FAIL（`pickSeconds` 未导出、`TaskInput` 形状不符）

- [ ] **Step 3: 实现**

`types.ts`：`JobInput` 改名 `TaskInput` 并改为上面的形状；`ProviderAdapter.submit` 参数类型随之改。

`kie.ts` 的 `buildKieInput`：

```ts
export function buildKieInput(route: RouteSeed, input: TaskInput): Record<string, unknown> {
  if (!route.aspects.includes(input.aspect))
    throw new ProviderError("invalid", `aspect ${input.aspect} is not accepted by ${route.model}`);
  const m = route.model;
  const p = route.params;
  if (m.startsWith("nano-banana")) return { prompt: input.prompt, image_input: input.images, aspect_ratio: input.aspect, ...p };
  if (m.startsWith("seedream/")) return { prompt: input.prompt, image_urls: input.images, aspect_ratio: input.aspect, ...p };
  if (m.startsWith("gpt-image-2") || m.startsWith("flux-2/")) return { prompt: input.prompt, input_urls: input.images, aspect_ratio: input.aspect, ...p };
  // Video: every route animates a keyframe.
  if (!input.first || input.seconds === undefined) throw new ProviderError("invalid", `${m} needs a first frame and seconds`);
  const { first, last, seconds } = input;
  if (m.startsWith("bytedance/seedance-2"))
    return { prompt: input.prompt, first_frame_url: first, ...(last ? { last_frame_url: last } : {}), aspect_ratio: input.aspect, duration: seconds, generate_audio: false, ...p };
  if (m === "kling-3.0/video")
    return { prompt: input.prompt, image_urls: last ? [first, last] : [first], sound: false, duration: String(seconds), multi_shots: false, ...p };
  if (m === "veo-3-1")
    return { prompt: input.prompt, generation_type: "FIRST_AND_LAST_FRAMES_2_VIDEO", image_urls: last ? [first, last] : [first], aspect_ratio: input.aspect, duration: seconds, ...p };
  if (m === "wan/2-7-image-to-video")
    return { prompt: input.prompt, first_frame_url: first, ...(last ? { last_frame_url: last } : {}), duration: seconds, prompt_extend: false, ...p };
  throw new ProviderError("invalid", `no kie input mapping for model ${m}`);
}
```

（`params` 里的值是字符串；视频路由的数字参数只有 `duration`，由 runner 传 `seconds`，不放进 params。）

`select.ts`：删 `padAspects`、`chargeTier`；新增

```ts
export function pickSeconds(route: RouteSeed, targetSec: number): number {
  const min = route.minSec ?? 1;
  const max = route.maxSec ?? 15;
  const want = Math.min(max, Math.max(min, Math.ceil(targetSec)));
  if (!route.allowedSec?.length) return want;
  return route.allowedSec.find((s) => s >= want) ?? route.allowedSec[route.allowedSec.length - 1];
}
```

`fake.ts`：`FakeAdapter.submit` 的参数类型改为 `TaskInput`，行为不变。原有 `kie.test.ts` 里 seedream / nano-banana 的入参断言改为 `images` 数组形式。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @vzc/providers test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/providers
git commit -m "feat(providers): kie input mapping for keyframe and video model families"
```

---

### Task 4: 路由种子（按评测结论）

**Files:**
- Modify: `packages/catalog/src/routes.ts`、`packages/catalog/test/routes.test.ts`

**Interfaces:**
- Produces: `RouteSeed` 去掉 `padAspect`、`creditsTier`，新增可选 `minSec?: number; maxSec?: number; allowedSec?: number[]`；`ROUTES` 为 `keyframe` 与 `shot` 两个能力的种子

种子内容以 `docs/model-eval.md` 的「默认 / 备用」为准：每个能力 rank 1 = 默认模型、rank 2 = 备用模型、rank 3 = 第二备用（如有）。`timeoutMs` = 评测 p90 × 2（取整到 10 秒，最少 120 秒；视频最少 300 秒）。`costUsd` = 评测实测单次平均。`params` 只放字符串（`resolution`、`output_format`、`quality`、`mode`、`model` 等），与 `eval/src/candidates.ts` 中对应候选的固定参数一致。宠物版若评测结论不同，加 `mode: "pet"` 的同 rank 路由覆盖。

- [ ] **Step 1: 写失败的测试（追加到 `routes.test.ts`）**

```ts
it("each capability has exactly one rank-1 route and at least one fallback", () => {
  for (const cap of CAPABILITY_IDS) {
    const rs = ROUTES.filter((r) => r.capability === cap && r.mode === null);
    expect(rs.filter((r) => r.rank === 1)).toHaveLength(1);
    expect(rs.some((r) => r.rank > 1)).toBe(true);
  }
});

it("video routes declare their duration limits and image routes do not", () => {
  for (const r of ROUTES) {
    if (r.capability === "shot") expect(r.minSec).toBeGreaterThan(0);
    else expect(r.minSec).toBeUndefined();
    expect(r.aspects).toContain("9:16");
  }
});
```

- [ ] **Step 2: 运行确认失败**；**Step 3: 按评测结论写 `ROUTES`**；**Step 4: 运行确认通过**

Run: `pnpm --filter @vzc/catalog test -- routes`
Expected: 先 FAIL，写完 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): keyframe and shot route seeds from the model eval"
```

---

### Task 5: contracts —— 故事接口

**Files:**
- Create: `packages/contracts/src/stories.ts`、`packages/contracts/test/stories.test.ts`
- Modify: `packages/contracts/src/errors.ts`、`index.ts`；删除 `geometry.ts`、`jobs.ts` 及测试（图片专用）

**Interfaces:**
- Produces:
  - `CreateStorySchema = z.object({ survivorKey: UploadKey, infectedKey: UploadKey, kind: z.enum(KINDS), scene: z.enum(SCENE_IDS), names: z.string().trim().max(40).optional(), date: z.string().trim().max(20).optional(), idempotencyKey: z.string().min(8).max(64) })`（`UploadKey = /^in\/[0-9A-HJKMNP-TV-Z]{26}\.jpg$/`）；`swap` 不需要字段——「谁变丧尸」由前端交换两个 key 实现
  - `RenderSchema = z.object({ idempotencyKey: z.string().min(8).max(64) })`
  - `RecomposeSchema = z.object({ names: z.string().trim().max(40), date: z.string().trim().max(20) })`
  - `type StoryStatus = "previewing" | "preview_ready" | "preview_failed" | "rendering" | "done" | "failed"`
  - `type StoryView = { id: string; status: StoryStatus; kind: Kind; scene: SceneId; names: string | null; date: string | null; preview: { A: string; C: string } | null; video: { url: string; poster: string; expiresAt: number } | null; progress: { done: number; total: number }; errorCode: ErrorCode | null; recomposeLeft: number; createdAt: number }`（URL 为 1 小时预签名 GET）
  - 新错误码：`PREVIEW_QUOTA_EXHAUSTED`、`LOGIN_REQUIRED`、`NOT_READY`、`ALREADY_RENDERED`、`RECOMPOSE_USED`、`FACE_NOT_FOUND`、`UNDERAGE`、`COMPOSE_FAILED`

- [ ] **Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { CreateStorySchema, RecomposeSchema } from "../src/index.ts";

const key = "in/01HZX5V3Q4W7E8R9T0Y1U2I3O4.jpg";

describe("story contracts", () => {
  it("accepts a valid story request", () => {
    expect(CreateStorySchema.safeParse({ survivorKey: key, infectedKey: key, kind: "human", scene: "cabin-wheat", idempotencyKey: "abcdefgh" }).success).toBe(true);
  });
  it("rejects foreign keys and unknown scenes", () => {
    expect(CreateStorySchema.safeParse({ survivorKey: "keep/x.jpg", infectedKey: key, kind: "human", scene: "cabin-wheat", idempotencyKey: "abcdefgh" }).success).toBe(false);
    expect(CreateStorySchema.safeParse({ survivorKey: key, infectedKey: key, kind: "human", scene: "mars", idempotencyKey: "abcdefgh" }).success).toBe(false);
  });
  it("caps caption length", () => {
    expect(RecomposeSchema.safeParse({ names: "x".repeat(41), date: "2019" }).success).toBe(false);
  });
});
```

（注：ULID 字母表不含 I、O、L、U，测试用的 key 要换成合法 ULID，例如 `in/01HZX5V3Q4W7E8R9T0Y1Z2A3B4.jpg`。）

- [ ] **Step 2–4: 失败 → 实现 → 通过**

Run: `pnpm --filter @vzc/contracts test`

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): story request schemas, view and error codes"
```

---

### Task 6: 步骤图（纯函数）

**Files:**
- Create: `apps/api/src/stories/types.ts`、`apps/api/src/stories/graph.ts`、`apps/api/test/story-graph.test.ts`

**Interfaces:**
- Consumes: `STORYBOARD`、`CANDIDATES_PER_FRAME`、`keyframePrompt`、`shotPrompt`（Task 2）；`Route`（Task 3）
- Produces:
  - `type StorySpec = { id; owner; userId: string; kind: Kind; scene: SceneId; names: string|null; date: string|null; survivorKey: string; infectedKey: string; createdAt: number }`
  - `type StepKind = "kie" | "score" | "compose"`
  - `type StepId = string`（`kf:A:1`、`kf:A:2`、`kf:C:1`、`kf:C:2`、`score:AC`、`kf:B`、`shot:1`…`shot:4`、`compose`）
  - `type StepState = "waiting" | "queued" | "submitting" | "pending" | "succeeded" | "failed"`
  - `type StepRecord = { id: StepId; kind: StepKind; phase: "preview" | "video"; capability?: CapabilityId; deps: StepId[]; state: StepState; attempts: AttemptRecord[]; fallbacks: Route[]; outputKey: string | null; failures: number; nextRunAt: number | null; error: string | null }`
  - `type StoryState = { spec; status: StoryStatus; steps: Record<StepId, StepRecord>; picks: Partial<Record<FrameId, string>>; previewCharge: ChargeHold | null; videoCharge: ChargeHold | null; previewSettled: boolean; videoSettled: boolean; recomposeLeft: number; output: { videoKey: string; posterKey: string } | null; errorCode: ErrorCode | null; finishedAt: number | null; syncedSig: string }`
  - `previewSteps(): StepRecord[]`、`videoSteps(): StepRecord[]`
  - `readySteps(state: StoryState): StepRecord[]`（`waiting` 且所有 deps `succeeded` 的步骤）
  - `phaseOutcome(state: StoryState, phase): "running" | "succeeded" | "failed"`
  - `kieInputFor(step, state, urls: (key: string) => Promise<string>): Promise<{ prompt: string; images: string[]; first?: string; last?: string; targetSec?: number }>`
  - `outputKeyFor(storyId: string, step: StepId, ext: "jpg" | "mp4"): string`（`kf/<id>/<step>.jpg`、`shot/<id>/<step>.mp4`）

依赖关系：预览阶段 4 个 `kf:*` 无依赖，`score:AC` 依赖全部 4 个，但**只要每帧至少 1 个候选成功**就可以打分（`readySteps` 对 `score:AC` 特判：A 至少一个成功、C 至少一个成功，且四个都已结束）。视频阶段：`kf:B` 无依赖；`shot:1`、`shot:2`、`shot:4` 无依赖（用 picks.A / picks.C）；`shot:3` 依赖 `kf:B`；`compose` 依赖 4 个 shot。

- [ ] **Step 1: 写失败的测试 `apps/api/test/story-graph.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { phaseOutcome, previewSteps, readySteps, videoSteps } from "../src/stories/graph.ts";
import type { StoryState } from "../src/stories/types.ts";

function state(over: Partial<StoryState> = {}): StoryState {
  const steps = Object.fromEntries([...previewSteps(), ...videoSteps()].map((s) => [s.id, s]));
  return {
    spec: { id: "S", owner: "u:1", userId: "1", kind: "human", scene: "cabin-wheat", names: null, date: null, survivorKey: "in/s.jpg", infectedKey: "in/i.jpg", createdAt: 0 },
    status: "previewing",
    steps,
    picks: {},
    previewCharge: null,
    videoCharge: null,
    previewSettled: false,
    videoSettled: false,
    recomposeLeft: 1,
    output: null,
    errorCode: null,
    finishedAt: null,
    syncedSig: "",
    ...over,
  };
}
const set = (s: StoryState, id: string, st: StoryState["steps"][string]["state"]) => (s.steps[id].state = st);

describe("story graph", () => {
  it("preview starts with four keyframe candidates", () => {
    expect(readySteps(state()).filter((s) => s.phase === "preview").map((s) => s.id)).toEqual(["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"]);
  });

  it("scoring waits for all candidates to end, and needs one A and one C", () => {
    const s = state();
    set(s, "kf:A:1", "succeeded");
    set(s, "kf:C:1", "succeeded");
    set(s, "kf:A:2", "pending");
    set(s, "kf:C:2", "failed");
    expect(readySteps(s).some((x) => x.id === "score:AC")).toBe(false);
    set(s, "kf:A:2", "failed");
    expect(readySteps(s).some((x) => x.id === "score:AC")).toBe(true);
  });

  it("preview fails when every A candidate failed", () => {
    const s = state();
    for (const id of ["kf:A:1", "kf:A:2"]) set(s, id, "failed");
    for (const id of ["kf:C:1", "kf:C:2"]) set(s, id, "succeeded");
    expect(phaseOutcome(s, "preview")).toBe("failed");
  });

  it("video phase steps are not ready during preview", () => {
    expect(readySteps(state()).some((x) => x.phase === "video")).toBe(false);
  });

  it("in the video phase shot 3 waits for keyframe B and compose waits for all shots", () => {
    const s = state({ status: "rendering", picks: { A: "kf/S/a.jpg", C: "kf/S/c.jpg" } });
    for (const id of ["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2", "score:AC"]) set(s, id, "succeeded");
    expect(readySteps(s).map((x) => x.id).sort()).toEqual(["kf:B", "shot:1", "shot:2", "shot:4"]);
    set(s, "kf:B", "succeeded");
    expect(readySteps(s).map((x) => x.id)).toContain("shot:3");
    for (const id of ["shot:1", "shot:2", "shot:3", "shot:4"]) set(s, id, "succeeded");
    expect(readySteps(s).map((x) => x.id)).toEqual(["compose"]);
  });

  it("video fails as soon as one required step fails", () => {
    const s = state({ status: "rendering" });
    set(s, "shot:2", "failed");
    expect(phaseOutcome(s, "video")).toBe("failed");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vzc/api test -- story-graph`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `types.ts` 与 `graph.ts`**

`graph.ts` 核心：

```ts
import { CANDIDATES_PER_FRAME, STORYBOARD } from "@vzc/catalog";
import type { StepRecord, StoryState } from "./types.ts";

const step = (id: string, kind: StepRecord["kind"], phase: StepRecord["phase"], deps: string[], capability?: StepRecord["capability"]): StepRecord => ({
  id, kind, phase, capability, deps, state: "waiting", attempts: [], fallbacks: [], outputKey: null, failures: 0, nextRunAt: null, error: null,
});

export function previewSteps(): StepRecord[] {
  const kf = (["A", "C"] as const).flatMap((f) => Array.from({ length: CANDIDATES_PER_FRAME }, (_, i) => step(`kf:${f}:${i + 1}`, "kie", "preview", [], "keyframe")));
  return [...kf, step("score:AC", "score", "preview", kf.map((s) => s.id))];
}

export function videoSteps(): StepRecord[] {
  const shots = STORYBOARD.map((s) => step(`shot:${s.id}`, "kie", "video", s.last === "B" ? ["kf:B"] : [], "shot"));
  return [step("kf:B", "kie", "video", [], "keyframe"), ...shots, step("compose", "compose", "video", shots.map((s) => s.id))];
}

const ended = (s: StepRecord) => s.state === "succeeded" || s.state === "failed";

export function readySteps(state: StoryState): StepRecord[] {
  const phase = state.status === "previewing" ? "preview" : state.status === "rendering" ? "video" : null;
  if (!phase) return [];
  return Object.values(state.steps).filter((s) => {
    if (s.phase !== phase || s.state !== "waiting") return false;
    const deps = s.deps.map((d) => state.steps[d]);
    if (s.id === "score:AC") return deps.every(ended) && (["A", "C"] as const).every((f) => deps.some((d) => d.id.startsWith(`kf:${f}:`) && d.state === "succeeded"));
    return deps.every((d) => d.state === "succeeded");
  });
}

export function phaseOutcome(state: StoryState, phase: "preview" | "video"): "running" | "succeeded" | "failed" {
  const steps = Object.values(state.steps).filter((s) => s.phase === phase);
  if (phase === "preview") {
    for (const f of ["A", "C"] as const) {
      const cands = steps.filter((s) => s.id.startsWith(`kf:${f}:`));
      if (cands.every((s) => s.state === "failed")) return "failed";
    }
    const score = state.steps["score:AC"];
    return score.state === "succeeded" ? "succeeded" : score.state === "failed" ? "failed" : "running";
  }
  if (steps.some((s) => s.state === "failed")) return "failed";
  return state.steps.compose.state === "succeeded" ? "succeeded" : "running";
}
```

`kieInputFor`：`kf:A:*` / `kf:C:*` → `images=[survivor, infected]`、prompt `keyframePrompt(scene, F, kind)`；`kf:B` → `images=[survivor, infected, picks.A, picks.C]`；`shot:N` → `first=picks[first]`、`last=picks[last]`（B 取 `steps["kf:B"].outputKey`）、`targetSec`、prompt `shotPrompt`。所有 key 经传入的 `urls()` 换成预签名 GET。

- [ ] **Step 4: 运行确认通过**；**Step 5: Commit**

```bash
git add apps/api/src/stories apps/api/test/story-graph.test.ts
git commit -m "feat(api): story step graph with preview and video phases"
```

---

### Task 7: StoryRunner Durable Object 与 composer 客户端

**Files:**
- Create: `apps/api/src/durable-objects/story-runner.ts`、`apps/api/src/services/composer.ts`、`apps/api/test/story-runner.test.ts`
- Modify: `apps/api/src/types.ts`（绑定 `STORY_RUNNER`、`COMPOSER`、`COMPOSER_URL?`、`FAKE_COMPOSER?`）、`apps/api/test/harness.ts`（注册 StoryRunner、假 composer）、`apps/api/src/index.ts`（导出类）
- Delete: `apps/api/src/durable-objects/job-runner.ts`、`apps/api/src/jobs/*`、`services/free-retry.ts`、`services/charge.ts` 中 `holdCharge`（改写见 Task 8）及对应测试 `job-runner.test.ts`、`retry*.test.ts`、`credit-jobs.test.ts`、`jobs-api.test.ts`、`journey.test.ts`（Task 8 写故事版的 journey）

**Interfaces:**
- Consumes: Task 6 全部；`planRoutes`、`pickSeconds`、`ProviderError`、`FailKind`（Task 3）；`settle`（保留，按 Task 8 改为按积分数结算）；`presign`、`callbackToken`、`loadRoutes`、`recordAttempt`、`pauseForKieCap`
- Produces:
  - `class StoryRunner extends DurableObject<Bindings>`：`start(spec: StorySpec, charge: ChargeHold): Promise<StoryView>`、`render(charge: ChargeHold): Promise<{ ok: true } | { ok: false; reason: "not_ready" | "already" }>`、`recompose(names: string, date: string): Promise<{ ok: boolean; reason?: "used" | "not_done" }>`、`view(): Promise<StoryView | null>`、`poke(): Promise<void>`、`cancel(): Promise<void>`、`giveUp(): Promise<"stopped"|"settled"|"missing">`、`alarm()`
  - `interface ComposerApi { score(req: ScoreRequest): Promise<ScoreResponse>; compose(req: ComposeRequest): Promise<{ ok: true; durationSec: number }> }`
  - `type ScoreRequest = { sources: { survivor: string; infected: string | null }; candidates: { id: string; url: string; frame: FrameId }[]; requiredFaces: Record<FrameId, Face[]>; checkAge: boolean }`
  - `type ScoreResponse = { scores: Record<string, number | null>; sourceFaces: { survivor: boolean; infected: boolean | null }; minAge: number | null }`
  - `type ComposeRequest = { shots: { url: string; seconds: number; grade: "cold" | "warm" }[]; musicUrl: string; caption: { line1: string; line2: string | null }; outUrl: string; posterUrl: string }`
  - `composerFor(env: Bindings): ComposerApi`（`FAKE_COMPOSER=1` 时返回假实现：打分给第 1 个候选 0.6 其余 0.5，合成直接把 shot 1 复制为成片）

行为（与 unblurpix JobRunner 相同的骨架：`#serial` 串行入口、`#tick` 内 try/finally 保存并排下一次 alarm、`#schedule` 取最早时间）：

1. `start`：保存 state（全部步骤）、`status = "previewing"`，tick。
2. `#tick`：对 `readySteps` 里的 kie 步骤 → 规划路由（`planRoutes(routes, capability, kind)` 取 primary + fallbacks）→ 进入 `queued`；对所有 `queued/submitting/pending` 的 kie 步骤执行 acquire / submit / poll（与 JobRunner 的 `#acquire/#submit/#poll` 同逻辑，ticket = `${storyId}:${stepId}:${attemptId}`，callback URL `/webhooks/kie/<storyId>?t=`）；成功则把结果下载到 `outputKeyFor`，失败按 FailKind：`invalid`、`key_daily_cap` 不回退，其余回退一次到下一个路由（每步最多 `MAX_FALLBACKS = 2`）；所有路由用尽 → 步骤 `failed`。
3. `score:AC` 就绪 → 调 `composer.score`（候选的预签名 URL；`checkAge = kind === "human"`）。`sourceFaces.survivor === false` 或（human 且 `infected === false`）→ 预览失败 `FACE_NOT_FOUND`；`minAge !== null && minAge < 18` → `UNDERAGE`；否则每帧取分数最高的成功候选（全为 null 取第一个成功的）写入 `picks`。composer 抛错 → `failures += 1`、`nextRunAt = now + min(15min, 30s × 2^(failures-1))`，`failures >= 5` 才判失败。
4. 预览结果：`phaseOutcome("preview")` 为 succeeded → `status = "preview_ready"`、结算 previewCharge 为成功（commitQuota）；failed → `status = "preview_failed"`、释放 previewCharge、`errorCode` 取最后一个失败步骤的 FailKind 映射（同 JobRunner 的 `FAIL_CODE`）或 `FACE_NOT_FOUND` / `UNDERAGE`。
5. `render(charge)`：只在 `preview_ready` 且 `videoCharge === null` 时接受；保存 charge、`status = "rendering"`、tick。重复调用返回 `already`。
6. compose 就绪 → `composer.compose`：shots 1–3 `grade: "cold"`、shot 4 `grade: "warm"`，`seconds = STORYBOARD[i].targetSec`，音乐 `SCENES[scene].musicKey` 的预签名 GET，字幕 `line1 = "Even at the end of the world."`、`line2 = names && date ? \`${names} · ${date}\` : names ?? null`，输出 `out/<id>/video.mp4` 与 `out/<id>/poster.jpg` 的预签名 PUT。失败重试同第 3 条。
7. 视频结果：succeeded → `status = "done"`、`output` 写入、结算 videoCharge（commit `TIERS.video.credits`）；failed → `status = "failed"`、释放 videoCharge、`errorCode`（compose 失败为 `COMPOSE_FAILED`）。
8. `recompose`：只在 `done` 且 `recomposeLeft > 0`；更新 spec.names/date、`recomposeLeft -= 1`、把 `compose` 步骤重置为 `waiting`、`status = "rendering"`；不新增扣费（`videoSettled` 已为 true，`render` 不会再扣）。
9. `#sync`：把 status、picks、output、errorCode、成本合计写入 D1 `stories` 行（签名比较去重，同 JobRunner）。
10. `#view`：`progress.done/total` 为当前阶段已成功步骤数 / 步骤数；`preview`、`video` 的 URL 用 1 小时预签名 GET。

- [ ] **Step 1: 写失败的测试 `apps/api/test/story-runner.test.ts`**（用 harness 的内存环境、假时钟、`FAKE_PROVIDER=1` 与 `FAKE_COMPOSER=1`）

必须覆盖的用例（每个一个 `it`）：
1. `preview succeeds: four candidates, scored, picks set, quota committed` —— 推进时钟直到 `status === "preview_ready"`，`picks.A`、`picks.C` 指向 `kf/<id>/kf:A:1.jpg` 等，quota 计数器已 commit。
2. `preview fails when all A candidates fail and releases quota` —— FAKE_SCRIPT 让 keyframe 路由全部 fail（`content_rejected`），状态 `preview_failed`，quota 已 release，`errorCode === "CONTENT_REJECTED"`。
3. `render before preview_ready is refused` —— 返回 `{ ok: false, reason: "not_ready" }`。
4. `render runs B, four shots and compose, then commits credits` —— 最终 `done`、`output.videoKey === "out/<id>/video.mp4"`、钱包 commit 10 积分。
5. `shot exhausts routes → video failed and credits released` —— shot 路由全部 fail，`status === "failed"`，钱包 release，已成功的 kf:B 不影响退款。
6. `compose retries then refunds` —— 假 composer 前 2 次 compose 抛错第 3 次成功 → `done`；另一用例一直抛错 → 第 5 次后 `failed`、`COMPOSE_FAILED`、release。
7. `poke is idempotent` —— 连续 poke 3 次，kie 状态查询次数与 1 次 poke 相同的步骤数一致，状态不变。
8. `recompose reruns only compose once` —— done 后 recompose → 只有 compose 重跑（shot 的 submit 计数不变）、积分不再变动、第二次 recompose 返回 `used`。
9. `face not found in source fails the preview with FACE_NOT_FOUND` —— 假 composer 返回 `sourceFaces.survivor = false`。
10. `underage source fails the preview with UNDERAGE` —— 假 composer 返回 `minAge = 14`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @vzc/api test -- story-runner`
Expected: FAIL（StoryRunner 不存在）

- [ ] **Step 3: 实现 composer 客户端与 StoryRunner**（按上面行为 1–10；复用 JobRunner 的 `newAttempt`、`bookEstimate`、`FAIL_CODE` 逻辑，移入 `stories/attempts.ts`）

`services/composer.ts` 的容器调用：

```ts
export function composerFor(env: Bindings): ComposerApi {
  if (env.FAKE_COMPOSER === "1") return fakeComposer(env);
  const call = async <T>(path: string, body: unknown, timeoutMs: number): Promise<T> => {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) };
    const res = env.COMPOSER_URL
      ? await fetch(`${env.COMPOSER_URL}${path}`, init)
      : await env.COMPOSER.get(env.COMPOSER.idFromName("composer")).fetch(`http://composer${path}`, init);
    if (!res.ok) throw new Error(`composer ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    score: (req) => call<ScoreResponse>("/score", req, 120_000),
    compose: (req) => call<{ ok: true; durationSec: number }>("/compose", req, 300_000),
  };
}
```

- [ ] **Step 4: 运行确认通过，并跑全量**

Run: `pnpm --filter @vzc/api test > /tmp/vzc-t7.log 2>&1; tail -15 /tmp/vzc-t7.log`
Expected: 全绿（已删掉的图片任务测试不再存在；ops / admin 中引用 `jobs` 的测试在 Task 8 一并改）

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat(api): StoryRunner durable object and composer client"
```

---

### Task 8: 故事接口、扣费、数据表、ops 适配

**Files:**
- Create: `apps/api/src/routes/stories.ts`、`apps/api/migrations/0006_stories.sql`、`apps/api/test/stories-api.test.ts`、`apps/api/test/story-journey.test.ts`
- Modify: `apps/api/src/router.ts`、`routes/webhooks.ts`、`services/charge.ts`、`services/settle.ts`、`services/quota.ts`、`routes/quota.ts`、`routes/uploads.ts`、`ops/*`（`stuck.ts`、`cleanup.ts`、`privacy.ts`、`failures.ts`、`costs.ts`、`spend.ts`）、`admin/jobs.ts` → `admin/stories.ts`、`services/delete-account.ts`、`services/merge.ts`
- Delete: `routes/jobs.ts`、`routes/tools.ts`、`services/guard*`（若有）及对应测试

**Interfaces:**
- Consumes: Task 5 schemas；Task 7 `StoryRunner`
- Produces:
  - `POST /v1/stories` → 201 `{ storyId }`：未登录 `LOGIN_REQUIRED`；限流；`requireHuman`；两张上传都要通过 `checkUpload`（同一访客、JPEG、短边 ≥ 384）——**任一失败直接返回，不占额度**；幂等键重复返回同一 storyId；`holdPreview`（quota 计数器 `quota:preview:user:<id>` 限 `QUOTA.previewUserDaily`、`quota:preview:ip:<seg>` 限 `QUOTA.previewIpSegmentDaily`），满了返回 `PREVIEW_QUOTA_EXHAUSTED`；上传移到 `keep/<storyId>/survivor.jpg`、`keep/<storyId>/infected.jpg`；插入 `stories` 行；`StoryRunner.start`
  - `GET /v1/stories/:id` → `StoryView`（只有 owner 可见）
  - `POST /v1/stories/:id/render` → 202：`holdVideo`（`paidPaused`、`DAILY_LIMIT`、钱包 reserve `TIERS.video.credits`，不足 `CREDITS_LOW`）；`StoryRunner.render`；返回 `not_ready` → 释放并 `NOT_READY`；`already` → 释放这次 hold 并返回 202（幂等）
  - `POST /v1/stories/:id/recompose` → 202 或 `RECOMPOSE_USED` / `NOT_READY`
  - `GET /v1/quota` → `{ previewsLeft, resetAt }`
  - `POST /webhooks/kie/:storyId` → poke StoryRunner
  - `settle(env, id, charge, credits: number | null)`：按积分数结算（null = 释放）

`0006_stories.sql`：

```sql
CREATE TABLE stories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  user_id TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  fp_hash TEXT,
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  scene TEXT NOT NULL,
  names TEXT,
  date TEXT,
  survivor_key TEXT NOT NULL,
  infected_key TEXT NOT NULL,
  status TEXT NOT NULL,
  picks TEXT NOT NULL DEFAULT '{}',
  steps TEXT NOT NULL DEFAULT '[]',
  output_key TEXT,
  poster_key TEXT,
  error_code TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  preview_charge TEXT,
  video_charge TEXT,
  idempotency_key TEXT NOT NULL,
  render_key TEXT,
  created_at INTEGER NOT NULL,
  rendered_at INTEGER,
  finished_at INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX stories_owner_key ON stories(owner, idempotency_key);
CREATE UNIQUE INDEX stories_render_key ON stories(id, render_key);
CREATE INDEX stories_user_created ON stories(user_id, created_at);
CREATE INDEX stories_status ON stories(status, created_at);
```

（旧 `jobs` 表保留不删——迁移只增不减；ops 改为读 `stories`。）

- [ ] **Step 1: 写失败的测试 `stories-api.test.ts`**，用例：
1. `guest gets LOGIN_REQUIRED`
2. `foreign upload rejected without quota`（另一访客的上传 key → `FORBIDDEN`，`GET /v1/quota` 仍为 3）
3. `fourth preview of the day is PREVIEW_QUOTA_EXHAUSTED`
4. `same idempotency key returns the same story`
5. `render without credits is CREDITS_LOW and leaves the story preview_ready`
6. `render twice charges once`（并发两个 render 请求 → 钱包只 reserve/commit 一次 10 积分）
7. `only the owner can read a story`（另一用户 → `NOT_FOUND`）
8. `kie callback with a bad token is FORBIDDEN; a good one pokes the runner`

`story-journey.test.ts`：登录 → 两次上传 → 建故事 → 推进到 preview_ready → 买次数包（Waffo webhook 模拟，沿用 `waffo-kit.ts`）→ render → 推进到 done → `GET` 返回 video URL → recompose 一次 → 第二次 `RECOMPOSE_USED`。

- [ ] **Step 2: 运行确认失败**；**Step 3: 实现**；**Step 4: 全量测试**

Run: `pnpm --filter @vzc/api test > /tmp/vzc-t8.log 2>&1; tail -15 /tmp/vzc-t8.log && pnpm typecheck && pnpm lint`
Expected: 全绿；ops / admin 测试已改为基于 `stories`（stuck：`rendering` 超过 30 分钟或 `previewing` 超过 15 分钟 → `giveUp`；privacy：90 天后清空 names/date 与 key；cleanup：按 RETENTION 删 R2 前缀）

- [ ] **Step 5: Commit**

```bash
git add -A apps/api
git commit -m "feat(api): story routes, preview quota and video credit holds, ops on stories"
```

---

### Task 9: composer 容器（打分 + 合成）与配乐

**Files:**
- Create: `apps/composer/Dockerfile`、`apps/composer/pyproject.toml`、`apps/composer/app.py`、`apps/composer/grade.py`、`apps/composer/score.py`、`apps/composer/fonts/`（一个 OFL 字体，按第 3 份计划的设计定稿；先用 `Cormorant Garamond` OFL）、`apps/composer/tests/test_grade.py`、`apps/composer/tests/test_app.py`、`apps/api/src/composer-container.ts`、`assets/music/README.md`、`eval/src/run-music.ts`
- Modify: `apps/api/wrangler.jsonc`、`wrangler.production.jsonc`（containers + durable object 绑定 `COMPOSER`）、`apps/api/package.json`（依赖 `@cloudflare/containers`）

**Interfaces:**
- Consumes: Task 7 `ScoreRequest`、`ScoreResponse`、`ComposeRequest`
- Produces:
  - `POST /score`、`POST /compose`、`GET /health`（端口 8080）
  - `grade.build_compose_cmd(parts: list[Part], music: str, caption_png: str, out: str) -> list[str]`
  - `class Composer extends Container`（`defaultPort = 8080`、`sleepAfter = "10m"`）

ffmpeg 规则：每段 `-t seconds`，`scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24`；`cold` 段 `eq=saturation=0.72:contrast=1.06,colorbalance=bs=0.10:ms=0.06:hs=0.04:rs=-0.04`；`warm` 段 `eq=saturation=1.08,colorbalance=rs=0.08:ms=0.03:bs=-0.06`；第 3、4 段之间硬切（匹配剪辑靠关键帧 B / C 构图一致）；最后接 1 秒字幕卡（黑底，Pillow 渲染 PNG，0.4 秒淡入）；全片叠一层轻颗粒 `noise=alls=6:allf=t`；音乐 `-shortest` 截到 12 秒，末尾 0.8 秒淡出；输出 `libx264 -crf 20 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart`；封面取第 4 段第 1 秒。

打分规则同 `eval/scripts/face_score.py`（buffalo_l、按帧需要的身份取最大余弦，视频不需要）；`minAge` = 源照片人脸 genderage 年龄估计的最小值（宠物那张跳过）；模型在镜像构建时预下载（不在请求时下载）；特征不写盘、不写日志。

- [ ] **Step 1: 写失败的测试 `tests/test_grade.py`**

```python
from grade import Part, build_compose_cmd


def test_cold_and_warm_filters_and_output_flags():
    parts = [Part("s1.mp4", 3, "cold"), Part("s2.mp4", 2.5, "cold"), Part("s3.mp4", 2.5, "cold"), Part("s4.mp4", 3, "warm")]
    cmd = build_compose_cmd(parts, "m.m4a", "cap.png", "out.mp4")
    joined = " ".join(cmd)
    assert joined.count("colorbalance=bs=0.10") == 3
    assert joined.count("colorbalance=rs=0.08") == 1
    assert "-t 3" in joined and "-t 2.5" in joined
    assert "+faststart" in joined and "libx264" in joined and "aac" in joined
    assert cmd[-1] == "out.mp4"


def test_caption_is_last_segment_of_one_second():
    parts = [Part("s1.mp4", 3, "cold")]
    joined = " ".join(build_compose_cmd(parts, "m.m4a", "cap.png", "out.mp4"))
    assert "-loop 1 -t 1 -i cap.png" in joined
```

`tests/test_app.py`：用 FastAPI `TestClient`；`/health` 200；`/compose` 用两段 1 秒的测试视频（测试里用 ffmpeg `testsrc` 生成）+ 静音音轨，`outUrl` / `posterUrl` 指向本地 `http.server` 收 PUT 的假服务（或 monkeypatch 上传函数写本地文件），断言输出时长 ≈ 段长之和 + 1 秒（ffprobe），分辨率 720×1280；`/score` 对无脸图片返回 `null`、`sourceFaces.survivor == false`。

- [ ] **Step 2: 运行确认失败**

Run: `cd apps/composer && uv run pytest -q`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `grade.py`、`score.py`、`app.py`、Dockerfile**

Dockerfile 要点：`FROM python:3.12-slim`；`apt-get install -y ffmpeg fonts-dejavu-core`；`pip install` 固定版本（fastapi、uvicorn、httpx、insightface==0.7.3、onnxruntime==1.20.1、opencv-python-headless==4.10.0.84、numpy<2.1、pillow）；构建时运行一次 `python -c "from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l').prepare(ctx_id=-1)"` 预下载模型；`EXPOSE 8080`；`CMD uvicorn app:app --host 0.0.0.0 --port 8080`。

- [ ] **Step 4: 运行确认通过并构建镜像**

Run: `cd apps/composer && uv run pytest -q && docker build -t vzc-composer . && docker run -d --rm -p 8080:8080 --name vzc-composer vzc-composer && sleep 20 && curl -s localhost:8080/health; docker stop vzc-composer`
Expected: pytest 全绿；`{"ok":true}`

- [ ] **Step 5: 配乐**

`eval/src/run-music.ts`：用 kie 的 Suno 接口为每个场景生成 1 段 ≥ 15 秒的器乐（提示：`cinematic emotional piano and strings, slow build, single soft drum hit at 8 seconds, no vocals`），下载为 `assets/music/<scene>.m4a`（ffmpeg 转码、截 15 秒、响度标准化 `loudnorm=I=-16`）。先 `--dry` 看 kie 返回的价格与 schema（`/api/v1/models` 里 `taskType` 含 Music 的模型，按 schema 填字段），再执行。`assets/music/README.md` 记录：生成模型、日期、kie 任务 id、提示词、kie / 模型服务条款中关于商用的条款链接。部署计划把 `assets/music/*` 上传到 R2 `assets/music/`。

- [ ] **Step 6: 容器接入 Worker**

`apps/api/src/composer-container.ts`：

```ts
import { Container } from "@cloudflare/containers";
export class Composer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}
```

`wrangler.jsonc` 加：

```jsonc
"containers": [{ "class_name": "Composer", "image": "../composer/Dockerfile", "max_instances": 3, "instance_type": "standard" }],
```

并在 `durable_objects.bindings` 加 `{ "name": "COMPOSER", "class_name": "Composer" }`、`exports` 加 `"Composer": { "type": "durable-object", "storage": "sqlite" }`（与现有 DO 同写法；若该 wrangler 版本要求 `migrations` 段，按 `wrangler deploy --dry-run` 的报错补 `new_sqlite_classes`）。

Run: `pnpm --filter @vzc/api dryrun`
Expected: dry-run 成功，列出 `COMPOSER` 绑定

- [ ] **Step 7: Commit**

```bash
git add apps/composer apps/api assets eval/src/run-music.ts
git commit -m "feat(composer): scoring and ffmpeg compose container, scene music"
```

---

### Task 10: 端到端冒烟（本地真实 kie + 本地 composer）

**Files:**
- Create: `apps/api/scripts/smoke-story.ts`

**Interfaces:**
- Consumes: 全部

脚本用 `wrangler dev`（本地 D1 / R2 / DO，`COMPOSER_URL=http://localhost:8080`，真实 `KIE_API_KEY` 来自 `~/.vzc-secrets/eval.env` 经 `.dev.vars` 注入、`.dev.vars` 已 gitignore），用评测的 `p01` 合成人物照片走完：上传 → 建故事 → 等 preview_ready → 给测试用户直接加 10 积分（本地 D1 SQL）→ render → 等 done → 下载成片到 `eval/results/smoke/` 并 ffprobe 检查 12 秒 ±0.3、720×1280。

- [ ] **Step 1: 写脚本**；**Step 2: 运行**

Run: `docker run -d --rm -p 8080:8080 --name vzc-composer vzc-composer && pnpm --filter @vzc/api exec tsx scripts/smoke-story.ts`
Expected: 打印各阶段耗时与 kie 实际花费；成片通过 ffprobe 检查；人工看一遍成片（脸像不像、转场、字幕、配乐）

- [ ] **Step 3: Commit**

```bash
git add apps/api/scripts/smoke-story.ts
git commit -m "test(api): local end-to-end story smoke with real kie and composer"
```
