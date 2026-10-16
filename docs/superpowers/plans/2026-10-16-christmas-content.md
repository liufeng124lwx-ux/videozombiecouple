# 「50 Christmases」内容：看图描述、定稿提示词、素材与评测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Part B tasks are run by the controller in the user's browser and with the user; they are not dispatched to subagents.

**Goal:** 让圣诞三个场景达到可上线质量：加「看图描述外貌」步骤与特写候选、按即梦结论定稿提示词、做齐场景素材与配乐、在测试站用线上模型评测通过——场景仍保持 `live: false`。

**Architecture:** catalog 里 `Story.describe` 开关、`Appearance` 类型与确定性的描述清洗函数；providers 新增同步的 `KieDescriber`（KIE `/claude/v1/messages` 与 OpenAI 兼容 chat 接口）；API 的步骤图在圣诞片前加 `describe` 步骤，描述只存在 DO 状态里、照片到期即清空；测试站用 `PREVIEW_SCENES` 开放未上线场景供评测下单；`eval/` 新增描述评测、关键帧评测、素材生成、测试站成片四个脚本。

**Tech Stack:** TypeScript（pnpm workspace，vitest，Hono/Workers，Durable Objects，D1），Node ≥ 24 脚本（`eval/`，`node --test`），Python（`uv`，insightface 打分），KIE（GPT Image 2、Kling 3.0、claude-haiku-5-5、Gemini Flash），即梦（浏览器），suno.com（浏览器）。

**Spec:** `docs/superpowers/specs/2026-10-16-christmas-content-design.md`（上级：`2026-10-15-christmas-story-design.md`；即梦依据：`docs/research/2026-10-15-christmas-jimeng-notes.md`）

## Global Constraints

- 先写失败的测试，再写实现（CLAUDE.md）。页面与接口里的数字只从 `packages/catalog` 读。
- 丧尸片不变：步骤 id 与依赖、提示词、10 积分、15 秒、合成请求、邮件——现有快照测试必须原样通过；`ZOMBIE.describe = false`。
- 圣诞场景保持 `live: false`；生产环境不得因本计划开放任何圣诞下单（`PREVIEW_SCENES` 只在 `ENVIRONMENT === "staging"` 生效）。
- **成本**：每单模型费目标 ≈ $1.92（11 张关键帧 + 25 s 镜头 + 描述）；`pricingGuard` 必须通过；评测每轮 ≤ $10（CLAUDE.md），总计 ≈ $20；每个花钱的脚本先打印预估、无 `--yes` 不执行；花费以 KIE `GET /api/v1/chat/credit` 前后差值实测，1 积分 = $0.005。
- **安全合规**：外貌描述只存 `state.appearance`（DO 存储），不进 D1 的 `steps`/`picks`/任何列、不进 `StoryView`、不写日志/Sentry/错误信息；照片到期（`spec.createdAt + RETENTION.workDays` 天）时清空，`purge()` 也清空。描述只含衣着与毛发；宗教性衣着名规范化为中性词；含禁止词的行作废。KIE 密钥只从 `~/.vzc-secrets/` 读、绝不打印或写进文件/日志。评测只用 `eval/data/personas` 的 AI 合成人像，产物在 git 忽略目录。不使用 KIE 的 Suno 接口；配乐只在 suno.com（Suno Pro 订阅期内，下次续费 2026-11-14）生成；音效只用 CC0。即梦只用于调试，结果不上线。
- 圣诞提示词版本 `c1`；订单 `prompt_version` 按故事记录。
- 提交信息格式沿用仓库：`feat(scope): …`，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。每个代码任务结束跑 `pnpm lint`、`pnpm typecheck`、受影响包测试；`eval/` 改动跑 `node --test eval/test/`。

## Review Focus

1. **描述模型返回了禁止词、超长行、多余行或格式不对** → 对应人描述为空，绝不把原文塞进提示词 → Task 2 测试。
2. **KIE 同步接口 HTTP 200 但体内 `code` 非 200（或 429/433）** → 视为失败并按 `classifyKie` 分类，换下一条路由 → Task 3 测试。
3. **描述在任何对外/持久化出口出现**（D1 行、`GET /v1/stories/:id`、日志、错误信息）→ 一律不得出现 → Task 5 测试。
4. **所有描述路由都失败** → 片子照常完成，描述为空，不扣错积分 → Task 5 测试。
5. **生产环境配置了 `PREVIEW_SCENES`** → 不生效，圣诞下单仍返回 `BAD_REQUEST` → Task 6 测试。

---

## Part A — 代码（子代理执行）

### Task 1: 圣诞故事数据定稿规则：describe 开关、外貌参数、特写候选、共用素材、提示词版本

**Files:**
- Modify: `packages/catalog/src/stories/types.ts`、`packages/catalog/src/stories/zombie.ts`、`packages/catalog/src/stories/christmas.ts`、`packages/catalog/src/modes.ts`、`packages/catalog/src/pricing.ts`（仅图片张数随数据变化，无需改代码）
- Create: `packages/catalog/src/stories/appearance.ts`（本任务只放类型与空值；清洗函数在 Task 2）
- Modify: `apps/api/src/routes/stories.ts`（`prompt_version` 按故事）
- Test: `packages/catalog/test/christmas.test.ts`、`packages/catalog/test/stories.test.ts`、`packages/catalog/test/pricing.test.ts`、`apps/api/test/stories-api.test.ts`

**Interfaces:**
- Produces:
  - `type Appearance = { survivor: string; infected: string }`，`EMPTY_APPEARANCE: Appearance = { survivor: "", infected: "" }`（`stories/appearance.ts`，经 `stories/index.ts` 导出）
  - `Story.describe: boolean`（zombie `false`，christmas `true`）
  - `StoryKeyframe.prompt(scene: string, kind: Kind, look?: Appearance): string`（zombie 忽略 `look`）
  - `promptVersionOf(storyId: StoryId, kind: Kind): string`（zombie → `MODES[kind].promptVersion`，christmas → `"c1"`）
  - 圣诞素材 key：`ornament` → `stories/christmas/shared/ornament.jpg`、`hands` → `stories/christmas/shared/hands.mp4`（三个场景同一 key）；`window` → `stories/christmas/<scene>/window.mp4`；音乐 `stories/christmas/<scene>/music.m4a`
  - 圣诞关键帧：`forgetCold`、`rememberClose` 的 `candidates: 2`，`refs` 只有本人照片；共 11 张图

- [ ] **Step 1: 改测试（先失败）**

`packages/catalog/test/christmas.test.ts`：把「scores the wide shot and the memory…」整段替换为：

```ts
  it("scores the wide shot, the memory and both close-ups; close-ups use only their own photo", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    for (const id of ["wide", "memory", "forgetCold", "rememberClose"])
      expect(byId[id]?.candidates, id).toBe(2);
    expect(byId.forgetCold?.refs).toEqual([{ photo: "infected" }]);
    expect(byId.rememberClose?.refs).toEqual([{ photo: "survivor" }]);
    expect(byId.forgetWarm?.refs).toEqual([{ photo: "infected" }, { frame: "forgetCold" }]);
    expect(byId.tree?.refs).toEqual([
      { photo: "survivor" },
      { photo: "infected" },
      { frame: "wide" },
      { asset: "ornament" },
    ]);
    expect(byId.embrace?.refs).toEqual([{ photo: "survivor" }, { photo: "infected" }, { frame: "tree" }]);
    expect(CHRISTMAS.keyframes.reduce((n, k) => n + k.candidates, 0)).toBe(11);
    expect(CHRISTMAS.describe).toBe(true);
  });

  it("shares the ornament and the hands clip across scenes; each scene has its own window and music", () => {
    const scenes = Object.values(CHRISTMAS.scenes);
    expect(new Set(scenes.map((s) => s.assets.ornament))).toEqual(
      new Set(["stories/christmas/shared/ornament.jpg"]),
    );
    expect(new Set(scenes.map((s) => s.assets.hands))).toEqual(
      new Set(["stories/christmas/shared/hands.mp4"]),
    );
    expect(new Set(scenes.map((s) => s.assets.window)).size).toBe(3);
    expect(new Set(scenes.map((s) => s.musicKey)).size).toBe(3);
  });

  it("puts each person's appearance line into the frames that redraw them, and nothing when it is empty", () => {
    const look = { survivor: "full beard", infected: "blue floral headscarf covering all hair" };
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    const wide = byId.wide?.prompt("snow-cabin", "human", look) ?? "";
    expect(wide).toContain("full beard");
    expect(wide).toContain("blue floral headscarf covering all hair");
    expect(byId.forgetCold?.prompt("snow-cabin", "human", look)).toContain("headscarf");
    expect(byId.forgetCold?.prompt("snow-cabin", "human", look)).not.toContain("full beard");
    expect(byId.rememberClose?.prompt("snow-cabin", "human", look)).toContain("full beard");
    for (const k of CHRISTMAS.keyframes) {
      const plain = k.prompt("snow-cabin", "human");
      expect(plain, k.id).not.toMatch(/Appearance to keep/);
      // The generic hair / head-covering clauses failed in 即梦 (research notes §9–10).
      expect(plain, k.id).not.toMatch(/silver-white hair|head covering|beard if they have one/);
    }
  });

  it("follows the 即梦 rules: who to look at, gender, one ornament", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    expect(byId.wide?.prompt("snow-cabin", "human")).toContain("not at the other person");
    expect(byId.wide?.prompt("snow-cabin", "human")).toContain("unmistakably elderly");
    for (const id of ["forgetCold", "rememberClose", "forgetWarm"])
      expect(byId[id]?.prompt("snow-cabin", "human"), id).toContain("the same gender as IMAGE 1");
    for (const id of ["tree", "embrace"])
      expect(byId[id]?.prompt("snow-cabin", "human"), id).toContain(
        "only this one heart ornament on the tree",
      );
  });
```

同文件 `every prompt keeps people recognizable…` 用例里，把 `if (k.id !== "memory") expect(p, k.id).toMatch(/aged to about 78/);` 改成：`if (["wide", "forgetCold", "rememberClose"].includes(k.id)) expect(p, k.id).toMatch(/late seventies/); else if (k.id !== "memory") expect(p, k.id).toMatch(/grown old/);`（第 1 轮帧写衰老，后续帧沿用前一帧里的老年样貌）。

`packages/catalog/test/stories.test.ts` 加：

```ts
  it("the zombie story never describes photos and ignores an appearance", () => {
    expect(ZOMBIE.describe).toBe(false);
    for (const k of ZOMBIE.keyframes)
      expect(k.prompt("cabin-wheat", "human", { survivor: "x", infected: "y" })).toBe(
        k.prompt("cabin-wheat", "human"),
      );
  });

  it("records the prompt version per story", () => {
    expect(promptVersionOf("zombie", "human")).toBe("h1");
    expect(promptVersionOf("zombie", "pet")).toBe("p1");
    expect(promptVersionOf("christmas", "human")).toBe("c1");
  });
```

（从 `../src/index.ts` 导入 `promptVersionOf`。）

`packages/catalog/test/pricing.test.ts` 的 Christmas 成本用例改为 11 张图：`expect(storyCostUsd(synthetic, CHRISTMAS).video).toBeCloseTo(1.1 + 25 / 3, 6);`，并把 `synthetic` 改成只给 keyframe 与 shot 定价、其余能力 0：

```ts
const synthetic = ROUTES.map((r) => ({
  ...r,
  costUsd: r.capability === "keyframe" ? 0.1 : r.capability === "shot" ? 1 : 0,
}));
```

`apps/api/test/stories-api.test.ts` 的「a Christmas render with credits for one zombie video…」用例里，在 `made.status` 断言后加：

```ts
      const version = h.db.prepare("SELECT prompt_version FROM stories WHERE id=?").get(made.body.storyId as string);
      expect(version).toEqual({ prompt_version: "c1" });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/catalog test && pnpm --filter @vzc/api test -- stories-api`
Expected: FAIL（`describe`、`promptVersionOf`、11 张图、新提示词措辞都还没有）。

- [ ] **Step 3: 类型与空值**

`packages/catalog/src/stories/appearance.ts`：

```ts
/**
 * What the describe step read from each photo (christmas content spec §2.3): head covering, hair,
 * facial hair, glasses. survivor = photo 1, infected = photo 2. "" = nothing usable.
 * Never stored outside the story's own Durable Object state (spec §7).
 */
export type Appearance = { survivor: string; infected: string };

export const EMPTY_APPEARANCE: Appearance = { survivor: "", infected: "" };
```

`stories/types.ts`：`StoryKeyframe.prompt` 改为 `prompt(scene: string, kind: Kind, look?: Appearance): string;`（`import type { Appearance } from "./appearance.ts";`），`Story` 加：

```ts
  /** Read each photo's head covering, hair, facial hair and glasses before the keyframes (christmas content spec §2). */
  describe: boolean;
```

`stories/index.ts` 加 `export * from "./appearance.ts";`。`zombie.ts` 加 `describe: false,`（`prompt` 签名不变，多余参数被忽略）。

`modes.ts` 加：

```ts
import type { StoryId } from "./stories/types.ts";

/** The prompt version stored on every story (christmas content spec §3). */
export function promptVersionOf(story: StoryId, kind: ModeId): string {
  return story === "christmas" ? "c1" : MODES[kind].promptVersion;
}
```

- [ ] **Step 4: 圣诞数据**

`packages/catalog/src/stories/christmas.ts`：

1. 资产 key：

```ts
const shared = (name: string) => `stories/christmas/shared/${name}`;
// in SCENES: assets: { ornament: shared("ornament.jpg"), hands: shared("hands.mp4"), window: asset(id, "window.mp4") }
```

2. 用下面的常量与关键帧替换原来的 `AGED` 及 7 个关键帧（`STYLE`、`SAFE`、`MOTION`、`ORNAMENT`、`FORGETS_CLOTHES`、`REMEMBERS_CLOTHES`、`SETTINGS`、`storyboard`、`overlays`、`title`、`holdSec`、`titleAt` 不变）：

```ts
import { type Appearance, EMPTY_APPEARANCE } from "./appearance.ts";

const OLD =
  "in their late seventies, unmistakably elderly: deep wrinkles across the forehead and around the eyes and mouth, sagging skin, age spots, thin hands";
const SAME = (n: number) =>
  `keeping the exact face shape, features, skin tone and gender of IMAGE ${n}, instantly recognizable as the same person fifty years older`;
const KEEP = (line: string) => (line ? ` Appearance to keep: ${line}.` : "");
const ONE_ORNAMENT = "only this one heart ornament on the tree";

type Look = Appearance | undefined;
const l = (look: Look) => look ?? EMPTY_APPEARANCE;

// keyframes:
    {
      id: "wide",
      refs: PHOTOS,
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `${s(scene).now}.`,
          `The person from IMAGE 2 sits in the armchair by the window in profile, wearing ${FORGETS_CLOTHES}, gazing out at the snow, not at the other person; they are ${OLD}, ${SAME(2)}.${KEEP(l(look).infected)}`,
          `The person from IMAGE 1 stands in the doorway holding two white enamel mugs with chipped rims, wearing ${REMEMBERS_CLOTHES}; they are ${OLD}, ${SAME(1)}.${KEEP(l(look).survivor)}`,
          "Wide shot, both faces clearly visible. Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "memory",
      refs: [...PHOTOS, { asset: "ornament" }],
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `${s(scene).memory}, warm golden light, soft haze, slightly overexposed like an old home movie.`,
          `The person from IMAGE 2 — face, hair, age and gender exactly as in IMAGE 2 —${KEEP(l(look).infected)} wearing a burgundy sweater, rests one hand on the cheek of the person from IMAGE 1 — face, hair, age and gender exactly as in IMAGE 1 —${KEEP(l(look).survivor)} wearing a grey hoodie; both laughing, faces close.`,
          `${ORNAMENT} exactly as in IMAGE 3 hangs on the small tree beside them.`,
          "Medium close-up, front three-quarter view, both faces clearly visible. Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetCold",
      refs: [{ photo: "infected" }],
      candidates: 2,
      faces: ["infected"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `Tight head-and-shoulders close-up of the person in IMAGE 1, ${OLD}, ${SAME(1)}, the same gender as IMAGE 1.${KEEP(l(look).infected)}`,
          `Wearing ${FORGETS_CLOTHES.split(",")[0]}. Sitting by the frosted window of ${s(scene).now}; cold blue moonlight on one side of the face, the unlit Christmas tree blurred behind.`,
          "Eyes looking out of the window, a distant, empty gaze. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "rememberClose",
      refs: [{ photo: "survivor" }],
      candidates: 2,
      faces: ["survivor"],
      petFaces: [],
      prompt: (scene, _kind, look) =>
        [
          STYLE,
          `Tight head-and-shoulders close-up of the person in IMAGE 1, ${OLD}, ${SAME(1)}, the same gender as IMAGE 1.${KEEP(l(look).survivor)}`,
          `Wearing ${REMEMBERS_CLOTHES}. Standing in the dark doorway of ${s(scene).now}; cold blue shadows, the unlit Christmas tree blurred behind.`,
          "A glint of moisture in the eyes, a small, sad smile. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "tree",
      refs: [...PHOTOS, { frame: "wide" }, { asset: "ornament" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          "The same room, the same two elderly people, the same clothes and the same cold blue moonlight as IMAGE 3.",
          `In the foreground, the person standing in IMAGE 3 — face from IMAGE 1 grown old, the same gender as IMAGE 1,${KEEP(l(look).survivor)} navy wool sweater — stands in profile at the unlit Christmas tree, raising ${ORNAMENT} exactly as in IMAGE 4 to a branch at eye level; ${ONE_ORNAMENT}.`,
          `In the soft-focus background, the person sitting in the armchair in IMAGE 3 — face from IMAGE 2 grown old, the same gender as IMAGE 2,${KEEP(l(look).infected)} cream cardigan.`,
          "Never swap the two people.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetWarm",
      refs: [{ photo: "infected" }, { frame: "forgetCold" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          `Exactly the same framing, person, face, clothes and room as IMAGE 2 — the person from IMAGE 1 grown old, the same gender as IMAGE 1${KEEP(l(look).infected)} — but now lit by warm amber Christmas-tree lights from the side instead of cold moonlight.`,
          "The eyes have come into focus and look just off camera at someone they love; tears welling but not falling, lips slightly parted. Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "embrace",
      refs: [...PHOTOS, { frame: "tree" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (_scene, _kind, look) =>
        [
          STYLE,
          `The same room, the same two elderly people and the same clothes as IMAGE 3, but the Christmas tree is now fully lit with warm amber lights, ${ONE_ORNAMENT}; pale dawn light at the frosted window, snow still falling.`,
          `They stand by the lit tree, foreheads touching, eyes closed, gentle smiles: the one in the navy sweater has the face of IMAGE 1 grown old and the same gender as IMAGE 1;${KEEP(l(look).survivor)} the one in the cream cardigan has the face of IMAGE 2 grown old and the same gender as IMAGE 2,${KEEP(l(look).infected)} one hand resting on the other's cheek.`,
          "Medium shot, both faces in profile, clearly recognizable. Never swap the two people.",
          SAFE,
        ].join(" "),
    },
```

并在 `CHRISTMAS` 上加 `describe: true,`。删除不再使用的 `AGED`。

（这些措辞是即梦 v2/v3/v5 的定稿方向，Part B 的即梦与 R1 可能再改措辞；测试锁的是规则，不锁整句。）

- [ ] **Step 5: `prompt_version` 按故事**

`apps/api/src/routes/stories.ts` 的 INSERT 绑定里，把 `MODES[spec.kind].promptVersion` 换成 `promptVersionOf(request.story, spec.kind)`（从 `@vzc/catalog` 导入，去掉不再用的 `MODES` 导入）。`apps/api/test/harness.ts` 的 `story()` 若也写了 `MODES[...]`，同样换成 `promptVersionOf(spec.story ?? "zombie", spec.kind)`。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @vzc/catalog test && pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint`
Expected: 全部 PASS（`pricingGuard()` 仍为 `[]`；丧尸用例不变）。

- [ ] **Step 7: Commit**

```bash
git add packages/catalog apps/api
git commit -m "feat(catalog): christmas c1 — appearance lines, close-up candidates from their own photo, shared ornament and hands, prompt version per story

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 外貌描述的指令与确定性清洗

**Files:**
- Modify: `packages/catalog/src/stories/appearance.ts`
- Test: `packages/catalog/test/appearance.test.ts`（新建）

**Interfaces:**
- Consumes: `Appearance`、`EMPTY_APPEARANCE`（Task 1）
- Produces: `DESCRIBE_PROMPT: string`、`APPEARANCE_MAX_CHARS = 120`、`parseAppearance(text: string): Appearance`

- [ ] **Step 1: 写失败的测试**

`packages/catalog/test/appearance.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { APPEARANCE_MAX_CHARS, DESCRIBE_PROMPT, parseAppearance } from "../src/index.ts";

describe("appearance lines", () => {
  it("reads two lines into photo 1 (survivor) and photo 2 (infected)", () => {
    expect(
      parseAppearance("IMAGE 1: short blond hair, clean-shaven, no glasses\nIMAGE 2: long wavy red hair"),
    ).toEqual({ survivor: "short blond hair, clean-shaven, no glasses", infected: "long wavy red hair" });
  });

  it("tolerates spacing, case, bullets and extra chatter, keeping the first line per image", () => {
    const text = "Sure! Here you go:\n- image 2 : bald head, grey stubble\n* IMAGE 1:short curly black hair\nIMAGE 1: ignored";
    expect(parseAppearance(text)).toEqual({ survivor: "short curly black hair", infected: "bald head, grey stubble" });
  });

  it("renames religious garments to neutral words", () => {
    expect(parseAppearance("IMAGE 2: blue floral hijab covering all hair").infected).toBe(
      "blue floral headscarf covering all hair",
    );
    expect(parseAppearance("IMAGE 1: black Turban, full beard").survivor).toBe("black head wrap, full beard");
    expect(parseAppearance("IMAGE 1: kippah, short hair").survivor).toBe("small cap, short hair");
  });

  it("drops a line that infers religion, ethnicity, nationality, health or age", () => {
    for (const bad of [
      "Muslim woman in a headscarf",
      "Asian man, short black hair",
      "looks about 35 years old, short hair",
      "Caucasian, blond hair",
      "appears pregnant",
      "wheelchair user, short hair",
      "Indian, long black braid",
    ])
      expect(parseAppearance(`IMAGE 1: ${bad}\nIMAGE 2: long red hair`), bad).toEqual({
        survivor: "",
        infected: "long red hair",
      });
  });

  it("keeps hair colours like white and black hair (they are not ethnicity)", () => {
    expect(parseAppearance("IMAGE 1: white hair, black glasses").survivor).toBe("white hair, black glasses");
  });

  it("caps a line, strips control characters, and gives empty lines for garbage", () => {
    const long = `IMAGE 1: ${"very ".repeat(60)}long hair`;
    expect(parseAppearance(long).survivor.length).toBeLessThanOrEqual(APPEARANCE_MAX_CHARS);
    expect(parseAppearance("IMAGE 1: short\u0000 hair\u0007").survivor).toBe("short hair");
    expect(parseAppearance("")).toEqual({ survivor: "", infected: "" });
    expect(parseAppearance("I can't help with that.")).toEqual({ survivor: "", infected: "" });
  });

  it("instructs the model to describe only what is visible, in the fixed format", () => {
    expect(DESCRIBE_PROMPT).toContain("IMAGE 1:");
    expect(DESCRIBE_PROMPT).toContain("IMAGE 2:");
    expect(DESCRIBE_PROMPT).toMatch(/never mention (age|religion)/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/catalog test -- appearance`
Expected: FAIL（导出不存在）。

- [ ] **Step 3: 实现**

在 `packages/catalog/src/stories/appearance.ts` 追加：

```ts
export const APPEARANCE_MAX_CHARS = 120;

/** Sent with the two photos to the describe route (christmas content spec §2.3). */
export const DESCRIBE_PROMPT = [
  "You will see two photos, IMAGE 1 and IMAGE 2, each of one person.",
  "For each photo, list only what is visible on the head and face: head covering (colour, pattern, how much hair it covers) or none, hair (length, colour, style, or bald), facial hair, glasses.",
  "Never mention age, religion, ethnicity, nationality, skin colour, health, disability or body shape. Do not guess anything that is not visible.",
  "Answer with exactly two lines and nothing else:",
  "IMAGE 1: <comma-separated visible features>",
  "IMAGE 2: <comma-separated visible features>",
].join("\n");

const RENAME: readonly [RegExp, string][] = [
  [/\b(hijab|niqab|khimar|chador|burqa|al-amira)\b/gi, "headscarf"],
  [/\b(turban|dastar|pagri|keski)\b/gi, "head wrap"],
  [/\b(kippah|kippa|yarmulke|kufi|taqiyah)\b/gi, "small cap"],
];

/** Inferences the line must never carry; hair colours like "white hair" are allowed. */
const BANNED =
  /\b(muslim|islam\w*|christian\w*|catholic|jewish|jew|sikh\w*|hindu\w*|buddhis\w*|religio\w*|arab\w*|asian|african|caucasian|latin[oa]|latinx|hispanic|indian|ethnic\w*|race|racial|nationality|american|european|chinese|japanese|korean|mexican|disab\w*|wheelchair|ill(ness)?|disease|sick|pregnan\w*|years?\s+old|\d+\s*(years?|yrs?)|elderly|teen\w*|child)\b/i;

function clean(line: string): string {
  let out = line.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  for (const [pattern, word] of RENAME) out = out.replace(pattern, word);
  if (BANNED.test(out)) return "";
  if (out.length > APPEARANCE_MAX_CHARS) {
    const cut = out.slice(0, APPEARANCE_MAX_CHARS);
    out = cut.slice(0, Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" "))).trim();
  }
  return out;
}

/** The model's answer → one safe line per photo; anything unusable becomes "". */
export function parseAppearance(text: string): Appearance {
  const found: Record<"1" | "2", string | undefined> = { "1": undefined, "2": undefined };
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*[-*•]?\s*image\s*([12])\s*:\s*(.+)$/i);
    if (!m) continue;
    const key = m[1] as "1" | "2";
    if (found[key] === undefined) found[key] = clean(m[2] as string);
  }
  return { survivor: found["1"] ?? "", infected: found["2"] ?? "" };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vzc/catalog test && pnpm typecheck && pnpm lint`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): the describe prompt and a deterministic appearance cleaner — neutral garment words, inferences dropped, capped

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: providers：`describe` 能力、路由与同步的 KieDescriber

**Files:**
- Create: `eval/src/probe-describe.ts`（抓真实响应形状，约 $0.01）
- Create: `packages/providers/src/describe.ts`
- Modify: `packages/providers/src/index.ts`、`packages/providers/src/fake.ts`（加 `FakeDescriber`）
- Modify: `packages/catalog/src/capabilities.ts`、`packages/catalog/src/routes.ts`、`packages/catalog/src/pricing.ts`
- Test: `packages/providers/test/describe.test.ts`（新建，含 `test/fixtures/describe-*.json`）、`packages/catalog/test/routes.test.ts`、`packages/catalog/test/pricing.test.ts`

**Interfaces:**
- Consumes: `RouteSeed`、`classifyKie`、`ProviderError`、`DESCRIBE_PROMPT`
- Produces:
  - `CAPABILITY_IDS` 加 `"describe"`；`CAPABILITIES.describe = { id: "describe", pool: "kie-text", p50Ms: 5_000 }`（`pool` 类型加 `"kie-text"`）
  - 路由：`describe:claude-haiku:1`（model `claude-haiku-5-5`）、`describe:gemini-flash:2`（model 以 Step 1 探测与 KIE 目录为准，默认 `gemini-3-8-flash-openai`），`aspects: []`，`timeoutMs: 30_000`，`costUsd: 0.001`
  - `interface DescribeAdapter { describe(route: RouteSeed, prompt: string, images: string[]): Promise<{ text: string; costUsd: number | null }> }`
  - `class KieDescriber implements DescribeAdapter`（构造 `(apiKey: string, fetcher: typeof fetch = fetch)`）
  - `class FakeDescriber implements DescribeAdapter`（构造 `(answers: (string | { error: FailKind })[] = ["IMAGE 1: short dark hair\nIMAGE 2: long red hair"])`，按调用依次消费，耗尽后重复最后一个）
  - `storyCostUsd(routes, story)` 在 `story.describe` 时加上 describe 主路由成本

- [ ] **Step 1: 探测真实响应（花钱前先打印预估，需要 `--yes`）**

`eval/src/probe-describe.ts`：读 `~/.vzc-secrets/eval.env` 的 `KIE_API_KEY`（不打印）；把 `eval/data/personas/p06-infected.jpg` 与 `p03-survivor.jpg` 用 KIE base64 上传接口（`https://kieai.redpandaai.co/api/file-base64-upload`，`uploadPath: "vzc-eval/describe"`）拿到 `downloadUrl`；分别调用：

- `POST https://api.kie.ai/claude/v1/messages`，body `{"model":"claude-haiku-5-5","max_tokens":200,"messages":[{"role":"user","content":[{"type":"image","source":{"type":"url","url":U1}},{"type":"image","source":{"type":"url","url":U2}},{"type":"text","text":DESCRIBE_PROMPT}]}]}`
- `POST https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions`，body `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":U1}},{"type":"image_url","image_url":{"url":U2}},{"type":"text","text":DESCRIBE_PROMPT}]}],"stream":false}`

把两份响应体原样写到 `eval/results/describe-probe/<model>.json`（git 忽略目录），再各写一份**去掉上传 URL** 的副本到 `packages/providers/test/fixtures/describe-claude.json`、`describe-gemini-openai.json`；另构造一份 `describe-error.json`：`{"code":433,"msg":"exceeded the daily limit","data":null}`。无 `--yes` 时只打印「将调用 2 次，预计 < $0.01」。

Run: `node eval/src/probe-describe.ts --yes`
Expected: 两个文件写出；在报告里记下各自的成功字段路径（例如 Claude 风格 `content[].text`，或包在 `{code,msg,data}` 信封里的 `data.content[].text`；OpenAI 风格 `choices[0].message.content`），Step 3 按实际形状实现。若某个模型返回非 200 或不支持图片 URL，在报告里写明，并从 KIE 目录挑另一个支持看图的便宜模型替换为备用路由（记录选择理由）。

- [ ] **Step 2: 写失败的测试**

`packages/providers/test/describe.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { ROUTES } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { FakeDescriber, KieDescriber, ProviderError } from "../src/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const route = (id: string) => {
  const r = ROUTES.find((x) => x.id === id);
  if (!r) throw new Error(`no route ${id}`);
  return r;
};
function fetcherReturning(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("KieDescriber", () => {
  it("sends Claude-style image blocks then the prompt, and reads the text answer", async () => {
    const f = fetcherReturning(fixture("describe-claude.json"));
    const out = await new KieDescriber("k", f.fn).describe(route("describe:claude-haiku:1"), "PROMPT", ["u1", "u2"]);
    expect(f.calls[0]?.url).toBe("https://api.kie.ai/claude/v1/messages");
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages[0].content).toEqual([
      { type: "image", source: { type: "url", url: "u1" } },
      { type: "image", source: { type: "url", url: "u2" } },
      { type: "text", text: "PROMPT" },
    ]);
    expect((f.calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    expect(out.text).toMatch(/IMAGE 1:/);
  });

  it("sends OpenAI-style image_url parts to the Gemini route and reads choices[0]", async () => {
    const f = fetcherReturning(fixture("describe-gemini-openai.json"));
    const r = ROUTES.find((x) => x.capability === "describe" && x.rank === 2);
    if (!r) throw new Error("no fallback describe route");
    const out = await new KieDescriber("k", f.fn).describe(r, "PROMPT", ["u1", "u2"]);
    expect(f.calls[0]?.url).toBe(`https://api.kie.ai/${r.model}/v1/chat/completions`);
    const body = JSON.parse(String(f.calls[0]?.init.body));
    expect(body.messages[0].content[0]).toEqual({ type: "image_url", image_url: { url: "u1" } });
    expect(body.stream).toBe(false);
    expect(out.text).toMatch(/IMAGE 2:/);
  });

  it("treats a code in the body as the outcome, even with HTTP 200", async () => {
    const f = fetcherReturning(fixture("describe-error.json"), 200);
    await expect(
      new KieDescriber("k", f.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toMatchObject({ name: "ProviderError", kind: "key_daily_cap" });
  });

  it("classifies HTTP errors and empty answers", async () => {
    const http = fetcherReturning('{"error":"busy"}', 429);
    await expect(
      new KieDescriber("k", http.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toBeInstanceOf(ProviderError);
    const empty = fetcherReturning('{"content":[]}');
    await expect(
      new KieDescriber("k", empty.fn).describe(route("describe:claude-haiku:1"), "P", ["u1", "u2"]),
    ).rejects.toMatchObject({ kind: "provider_error" });
  });
});

describe("FakeDescriber", () => {
  it("answers in order and can fail", async () => {
    const fake = new FakeDescriber(["IMAGE 1: a", { error: "provider_error" }]);
    const r = route("describe:claude-haiku:1");
    expect((await fake.describe(r, "p", ["1", "2"])).text).toBe("IMAGE 1: a");
    await expect(fake.describe(r, "p", ["1", "2"])).rejects.toMatchObject({ kind: "provider_error" });
  });
});
```

`packages/catalog/test/routes.test.ts` 加：

```ts
  it("has two describe routes, Claude Haiku first", () => {
    const d = ROUTES.filter((r) => r.capability === "describe").sort((a, b) => a.rank - b.rank);
    expect(d.map((r) => r.model)[0]).toBe("claude-haiku-5-5");
    expect(d).toHaveLength(2);
    expect(d.every((r) => r.aspects.length === 0 && r.costUsd <= 0.005)).toBe(true);
  });
```

`packages/catalog/test/pricing.test.ts` 加：

```ts
  it("a Christmas film also pays for one describe call; zombie films do not", () => {
    const priced = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "describe" ? 0.5 : 0 }));
    expect(storyCostUsd(priced, CHRISTMAS).video).toBeCloseTo(0.5, 6);
    expect(storyCostUsd(priced, ZOMBIE).video).toBeCloseTo(0, 6);
  });
```

- [ ] **Step 3: 实现**

`packages/catalog/src/capabilities.ts`：

```ts
export const CAPABILITY_IDS = ["keyframe", "shot", "describe"] as const;
// pool: "kie-image" | "kie-video" | "kie-text"
  describe: { id: "describe", pool: "kie-text", p50Ms: 5_000 },
```

`packages/catalog/src/routes.ts` 加一个 helper 与两条路由（`ROUTES` 末尾）：

```ts
const text = (s: Slot, key: string, model: string, costUsd: number, label: string): RouteSeed => ({
  id: `${s.capability}:${key}:${s.rank}`,
  mode: null,
  parallel: false,
  provider: "kie",
  model,
  params: {},
  timeoutMs: 30_000,
  aspects: [],
  costUsd,
  label,
  ...s,
});
// …
  text({ capability: "describe", rank: 1 }, "claude-haiku", "claude-haiku-5-5", 0.001, "Claude Haiku 5.5"),
  text({ capability: "describe", rank: 2 }, "gemini-flash", "gemini-3-8-flash-openai", 0.001, "Gemini Flash"),
```

（若 Step 1 换了备用模型，用实际 model 名。）

`packages/catalog/src/pricing.ts` 的 `storyCostUsd` 末尾：

```ts
  const describe = story.describe ? primary(routes, "describe") : 0;
  return { video: keyframe * images + shot * shotSec + describe };
```

`primary()` 在没有某能力路由时会 `Math.min()` 空数组得到 `Infinity`：给它加保护——无路由返回 0。

`packages/providers/src/describe.ts`：

```ts
import type { RouteSeed } from "@vzc/catalog";
import { classifyKie } from "./kie.ts";
import { type FailKind, ProviderError } from "./types.ts";

export interface DescribeAdapter {
  describe(route: RouteSeed, prompt: string, images: string[]): Promise<{ text: string; costUsd: number | null }>;
}

const KIE = "https://api.kie.ai";

/** Synchronous KIE chat calls (the model schema's path), one photo pair per call. */
export class KieDescriber implements DescribeAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async describe(route: RouteSeed, prompt: string, images: string[]) {
    const claude = route.model.startsWith("claude-");
    const url = claude ? `${KIE}/claude/v1/messages` : `${KIE}/${route.model}/v1/chat/completions`;
    const content = claude
      ? [...images.map((u) => ({ type: "image", source: { type: "url", url: u } })), { type: "text", text: prompt }]
      : [...images.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: prompt }];
    const body = claude
      ? { model: route.model, max_tokens: 200, messages: [{ role: "user", content }] }
      : { messages: [{ role: "user", content }], stream: false };
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(route.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(/timeout|abort/i.test(String(error)) ? "timeout" : "provider_error", "describe request failed");
    }
    const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const code = raw && typeof raw.code === "number" ? raw.code : null;
    if (!response.ok || (code !== null && code !== 200)) {
      const fail = { code: code ?? response.status, msg: typeof raw?.msg === "string" ? raw.msg : "" };
      throw new ProviderError(classifyKie(fail), `describe failed (${fail.code})`, fail.code);
    }
    const payload = (raw && "data" in raw && raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown> | null;
    const text = claude ? claudeText(payload) : openaiText(payload);
    if (!text) throw new ProviderError("provider_error", "describe returned no text");
    return { text, costUsd: route.costUsd };
  }
}

function claudeText(p: Record<string, unknown> | null): string {
  const blocks = Array.isArray(p?.content) ? (p?.content as { type?: string; text?: string }[]) : [];
  return blocks.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n").trim();
}

function openaiText(p: Record<string, unknown> | null): string {
  const choices = Array.isArray(p?.choices) ? (p?.choices as { message?: { content?: unknown } }[]) : [];
  const c = choices[0]?.message?.content;
  return typeof c === "string" ? c.trim() : "";
}
```

（错误信息里只放状态码，绝不放模型回答或图片 URL。若 Step 1 发现成功字段路径不同，按实际调整 `claudeText`/`openaiText`，测试 fixture 即真实形状。）

`packages/providers/src/fake.ts` 追加：

```ts
export class FakeDescriber implements DescribeAdapter {
  readonly calls: { model: string; images: string[] }[] = [];
  #i = 0;
  constructor(private readonly answers: (string | { error: FailKind })[] = ["IMAGE 1: short dark hair\nIMAGE 2: long red hair"]) {}
  async describe(route: RouteSeed, _prompt: string, images: string[]) {
    this.calls.push({ model: route.model, images });
    const a = this.answers[Math.min(this.#i++, this.answers.length - 1)] as string | { error: FailKind };
    if (typeof a !== "string") throw new ProviderError(a.error, "fake describe failure");
    return { text: a, costUsd: route.costUsd };
  }
}
```

`packages/providers/src/index.ts` 加 `export * from "./describe.ts";`。

- [ ] **Step 4: 检查以「任务制」假设遍历能力的地方**

Run: `grep -rn "CAPABILITY_IDS\|CAPABILITIES\[" apps/api/src packages | grep -v test`
对每处判断 `describe`（同步、无 `taskId`、不经 dispatcher）是否会被当成任务制处理——例如健康检查 cron、dispatcher 池、管理后台路由页、成本统计。会出错的地方显式跳过 `describe`（例如健康检查只对 `keyframe`/`shot` 发任务），并为该处补一个断言「describe 不被当成任务提交」的测试。路由同步（`seedRoutes`/部署时写 D1 `provider_routes`）应自然包含新行：加测试确认 `seedRoutes()` 输出含两条 describe 路由。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @vzc/providers test && pnpm --filter @vzc/catalog test && pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint`
Expected: PASS；`pricingGuard()` 仍为 `[]`。

- [ ] **Step 6: Commit**

```bash
git add eval/src/probe-describe.ts packages/providers packages/catalog apps/api
git commit -m "feat(providers): describe capability — Claude Haiku then Gemini Flash over KIE's sync chat endpoints, fixtures from real answers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 步骤图加 `describe`，关键帧拿到外貌描述

**Files:**
- Modify: `apps/api/src/stories/types.ts`、`apps/api/src/stories/graph.ts`
- Test: `apps/api/test/story-graph.test.ts`

**Interfaces:**
- Consumes: `Story.describe`、`Appearance`、`EMPTY_APPEARANCE`、`StoryKeyframe.prompt(scene, kind, look?)`
- Produces: `StepKind` 加 `"describe"`；`StoryState.appearance?: Appearance`；圣诞 `videoSteps` 首个步骤 `describe`，每个 `kf:*` 步骤（候选与单张）都依赖它；`kieInputFor` 把 `state.appearance ?? EMPTY_APPEARANCE` 传给 `prompt`；打分步骤 id 变为 `score:widememoryforgetColdrememberClose`

- [ ] **Step 1: 写失败的测试**

`apps/api/test/story-graph.test.ts` 里把「builds the Christmas chain…」用例改为：

```ts
  it("builds the Christmas chain: describe first, four scored frames in round one", () => {
    const d = deps(videoSteps(CHRISTMAS, "human"));
    expect(d.describe).toEqual([]);
    for (const id of ["kf:wide:1", "kf:memory:2", "kf:forgetCold:1", "kf:rememberClose:2"])
      expect(d[id], id).toEqual(["describe"]);
    const score = "score:widememoryforgetColdrememberClose";
    expect(d[score]).toEqual([
      "kf:wide:1", "kf:wide:2", "kf:memory:1", "kf:memory:2",
      "kf:forgetCold:1", "kf:forgetCold:2", "kf:rememberClose:1", "kf:rememberClose:2",
    ]);
    expect(d["kf:tree"]).toEqual([score]);
    expect(d["kf:forgetWarm"]).toEqual([score]);
    expect(d["kf:embrace"]).toEqual(["kf:tree"]);
    expect(d["shot:1"]).toEqual([score]);
    expect(d["shot:6"]).toEqual(["kf:forgetWarm"]);
    expect(d["shot:4"]).toBeUndefined();
  });

  it("zombie films have no describe step", () => {
    expect(videoSteps(ZOMBIE, "human").some((s) => s.kind === "describe")).toBe(false);
  });

  it("hands the appearance lines to the keyframe prompt", async () => {
    const s = stateOf(CHRISTMAS, ["describe"]);
    s.appearance = { survivor: "full beard", infected: "blue floral headscarf covering all hair" };
    const wide = await kieInputFor(s.steps["kf:wide:1"] as never, s, async (k) => `signed:${k}`);
    expect(wide.prompt).toContain("full beard");
    expect(wide.prompt).toContain("headscarf");
    s.appearance = undefined;
    const plain = await kieInputFor(s.steps["kf:wide:1"] as never, s, async (k) => `signed:${k}`);
    expect(plain.prompt).not.toContain("Appearance to keep");
  });
```

把文件里 `stateOf` 的 `picks` 改为 `{ wide: "kf/x/kf:wide:1.jpg", memory: "kf/x/kf:memory:2.jpg", forgetCold: "kf/x/kf:forgetCold:1.jpg", rememberClose: "kf/x/kf:rememberClose:1.jpg" }`，并把引用 `"score:widememory"` 的旧断言更新为新 id；「feeds each keyframe its refs in order…」里 tree 的期望不变；「starts a shot on its keyframe…」把 `stateOf(CHRISTMAS, ["kf:forgetCold"])` 改为依赖 picks（`shot:1` 的首帧是 `picks.forgetCold`），期望 `first: "signed:kf/x/kf:forgetCold:1.jpg"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- story-graph`
Expected: FAIL。

- [ ] **Step 3: 实现**

`apps/api/src/stories/types.ts`：`StepKind` 加 `"describe"`；`StoryState` 加

```ts
  /** The describe step's lines (christmas content spec §7): never synced to D1 or shown; cleared when the photos expire. */
  appearance?: Appearance;
```

`apps/api/src/stories/graph.ts` 的 `videoSteps`：

```ts
  const describe = story.describe ? [add(step("describe", "describe", "video", []))] : [];
  const pre = describe.map((s) => s.id);
  // candidates and singles: deps = [...pre, ...refDeps(k.refs)]
```

（`reduce` 会在单张关键帧已依赖打分步骤时去掉多余的 `describe`——打分步骤经候选间接依赖它。）返回顺序：`[...describe, ...candidates, ...score, ...singles, ...shots, compose]`。

`kieInputFor` 的关键帧分支：`prompt: k.prompt(spec.scene, spec.kind, state.appearance ?? EMPTY_APPEARANCE)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint`
Expected: PASS（丧尸步骤图测试不变）。

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(stories): a describe step before Christmas keyframes; prompts get each person's appearance line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 运行器执行 `describe`，描述只活在 DO 里

**Files:**
- Modify: `apps/api/src/durable-objects/story-runner.ts`、`apps/api/src/types.ts`（`FAKE_DESCRIBE?: string`）、`apps/api/src/services/provider-kit.ts`（或运行器取适配器的地方：加 describer）
- Test: `apps/api/test/story-runner.test.ts`

**Interfaces:**
- Consumes: `KieDescriber`、`FakeDescriber`、`DESCRIBE_PROMPT`、`parseAppearance`、`EMPTY_APPEARANCE`、`RETENTION.workDays`
- Produces: 运行器分派 `kind === "describe"` 的步骤；`FAKE_PROVIDER=1` 时用 `FakeDescriber`（`FAKE_DESCRIBE` 为 JSON 数组时按它应答）；描述在 `spec.createdAt + RETENTION.workDays * 86_400_000` 被闹钟清空

- [ ] **Step 1: 写失败的测试**

在 `apps/api/test/story-runner.test.ts` 的 `describe("StoryRunner: stories", …)` 里（复用已有的 `christmas(h)` 帮手）加：

```ts
  const SECRET = "IMAGE 1: SECRETBEARD full beard\nIMAGE 2: SECRETSCARF blue headscarf";

  it("describes the photos first, uses the lines in prompts, and never lets them out", async () => {
    const logs: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
    const h = await setup({ FAKE_DESCRIBE: JSON.stringify([SECRET]) });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    const view = await untilStatus(h, runner, "done");
    // used: the fake provider saw the line in a keyframe prompt
    const submitted = JSON.stringify(h.provider.submitted ?? []);
    expect(submitted).toContain("SECRETBEARD");
    // never out: D1 row, view, logs
    const row = JSON.stringify(h.db.prepare("SELECT * FROM stories WHERE id=?").get(spec.id));
    expect(row).not.toMatch(/SECRET/);
    expect(JSON.stringify(view)).not.toMatch(/SECRET/);
    expect(logs.join("\n")).not.toMatch(/SECRET/);
    for (const s of spies) s.mockRestore();
  });

  it("clears the lines when the photos expire, and on purge", async () => {
    const h = await setup({ FAKE_DESCRIBE: JSON.stringify([SECRET]) });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    await untilStatus(h, runner, "done");
    expect(JSON.stringify(await h.runnerState(spec.id))).toMatch(/SECRETBEARD/);
    await h.advance(3 * 86_400_000 + 60_000);
    expect(JSON.stringify(await h.runnerState(spec.id))).not.toMatch(/SECRET/);
  });

  it("finishes the film without lines when every describe route fails", async () => {
    const h = await setup({
      FAKE_DESCRIBE: JSON.stringify([{ error: "provider_error" }, { error: "timeout" }]),
    });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    await untilStatus(h, runner, "done");
    expect(JSON.stringify(h.provider.submitted ?? [])).not.toContain("Appearance to keep");
    expect(h.wallet.calls.some((c) => c[0] === "commit" && c[3] === 20)).toBe(true);
  });

  it("drops a line with a banned inference before it reaches a prompt", async () => {
    const h = await setup({
      FAKE_DESCRIBE: JSON.stringify(["IMAGE 1: Asian man, short black hair\nIMAGE 2: long red hair"]),
    });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    await untilStatus(h, runner, "done");
    const sent = JSON.stringify(h.provider.submitted ?? []);
    expect(sent).not.toMatch(/Asian/);
    expect(sent).toContain("long red hair");
  });
```

同文件上一份计划留下的「renders a Christmas film: nine keyframes, seven shots…」用例要同步更新：关键帧尝试数从 9 改为 11，并断言步骤里有一个 `describe`。

`h.provider.submitted` 是 harness 暴露的 `FakeAdapter.submitted`（若 harness 尚未暴露，在 `setup()` 返回值里加 `provider`）；`h.runnerState(id)` 返回该 DO 存储的 `StoryState`（若没有，在 harness 加一个读 DO storage 的帮手）。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- story-runner`
Expected: FAIL。

- [ ] **Step 3: 实现**

在运行器分派步骤的地方加 `describe` 分支，实现 `#describe(state, step)`：

```ts
  /** Christmas content spec §2.3, §7: read each photo's head and hair; keep the lines only here. */
  async #describe(state: StoryState, step: StepRecord): Promise<void> {
    const { spec } = state;
    const routes = (await this.#routes()).filter((r) => r.capability === "describe" && r.enabled).sort((a, b) => a.rank - b.rank);
    const images = [await this.#url(spec.survivorKey), await this.#url(spec.infectedKey)];
    const describer = this.#describer();
    for (const route of routes) {
      try {
        const { text, costUsd } = await describer.describe(route, DESCRIBE_PROMPT, images);
        state.appearance = parseAppearance(text);
        this.#bookCost(state, step, route, costUsd); // an AttemptRecord with the route and cost only — no text
        step.state = "succeeded";
        step.nextRunAt = null;
        this.#scheduleAppearanceClear(state);
        return;
      } catch (error) {
        const kind = error instanceof ProviderError ? error.kind : "provider_error";
        console.warn(JSON.stringify({ level: "warn", storyId: spec.id, describe: route.id, failKind: kind }));
      }
    }
    state.appearance = { ...EMPTY_APPEARANCE };
    step.state = "succeeded";
    step.error = "DESCRIBE_FAILED";
    step.nextRunAt = null;
    this.#scheduleAppearanceClear(state);
  }
```

- `#routes()`/`#url()`/成本记录：用运行器已有的取路由、签名 URL、记录尝试成本的方法（按现有命名替换上面的占位名）；尝试记录只含路由与成本，`failMsg` 为 `null`。
- `#describer()`：`env.FAKE_PROVIDER === "1"` → `new FakeDescriber(env.FAKE_DESCRIBE ? JSON.parse(env.FAKE_DESCRIBE) : undefined)`；否则 `new KieDescriber(env.KIE_API_KEY)`（与现有 kie 适配器读同一个 secret）。
- `#scheduleAppearanceClear(state)`：把 `spec.createdAt + RETENTION.workDays * 86_400_000` 加进运行器的闹钟时间集合；闹钟到点时 `delete state.appearance` 并保存。`purge()` 已 `deleteAll()`，无需改。
- 确认 D1 同步（`UPDATE stories SET … steps=? …`）序列化的是 `steps`/`picks` 等，不含 `appearance`；`#view` 不读 `appearance`；`syncedSig` 不含它。
- 重做（remake）会重置视频阶段步骤：`describe` 随之重跑（照片仍在时），属预期。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint`
Expected: PASS（含原有丧尸用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(stories): the runner describes Christmas photos first — lines stay in the Durable Object, cleared when the photos go, never logged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 测试站可预览未上线的场景（`PREVIEW_SCENES`）

**Files:**
- Create: `apps/api/src/services/orderable.ts`
- Modify: `apps/api/src/routes/stories.ts`、`apps/api/src/types.ts`、`apps/api/wrangler.jsonc`（staging vars）
- Test: `apps/api/test/stories-api.test.ts`、`apps/api/test/configs.test.ts`

**Interfaces:**
- Produces: `isOrderable(env: Pick<Bindings, "ENVIRONMENT" | "PREVIEW_SCENES">, story: Story, sceneId: string): boolean` —— 场景 `live`，或 `ENVIRONMENT === "staging"` 且 `PREVIEW_SCENES`（逗号分隔的 `story/scene`）包含 `${story.id}/${sceneId}`

- [ ] **Step 1: 写失败的测试**

`apps/api/test/stories-api.test.ts`：

```ts
  it("staging can preview a scene that is not live; production never can", async () => {
    for (const [env, status] of [
      [{ ENVIRONMENT: "staging", PREVIEW_SCENES: "christmas/snow-cabin" }, 201],
      [{ ENVIRONMENT: "production", PREVIEW_SCENES: "christmas/snow-cabin" }, 400],
      [{ ENVIRONMENT: "staging", PREVIEW_SCENES: "christmas/city-flat" }, 400],
    ] as const) {
      const h = await setup({ FAKE_COMPOSER: "1", ...env });
      const { session } = await signedIn(h);
      const a = await h.upload();
      const b = await h.upload();
      const res = await create(h, session, storyBody(a, b, { story: "christmas", scene: "snow-cabin" }));
      expect(res.status, JSON.stringify(env)).toBe(status);
    }
  });

  it("preview never allows a kind the story does not support", async () => {
    const h = await setup({ FAKE_COMPOSER: "1", ENVIRONMENT: "staging", PREVIEW_SCENES: "christmas/snow-cabin" });
    const { session } = await signedIn(h);
    const a = await h.upload();
    const b = await h.upload();
    const res = await create(h, session, storyBody(a, b, { story: "christmas", scene: "snow-cabin", kind: "pet" }));
    expect(res.status).toBe(400);
  });
```

`apps/api/test/configs.test.ts` 加：生产配置 `apps/api/wrangler.production.jsonc` 的 vars 里**没有** `PREVIEW_SCENES`；staging 配置的 `PREVIEW_SCENES` 只含 `christmas/` 开头的条目。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- stories-api configs`
Expected: FAIL。

- [ ] **Step 3: 实现**

`apps/api/src/services/orderable.ts`：

```ts
import type { Story } from "@vzc/catalog";
import type { Bindings } from "../types.ts";

/** A scene can be ordered when it is live, or on staging when PREVIEW_SCENES names it (christmas content plan, Task 6). */
export function isOrderable(env: Pick<Bindings, "ENVIRONMENT" | "PREVIEW_SCENES">, story: Story, sceneId: string): boolean {
  const scene = story.scenes[sceneId];
  if (!scene) return false;
  if (scene.live) return true;
  if (env.ENVIRONMENT !== "staging") return false;
  const listed = (env.PREVIEW_SCENES ?? "").split(",").map((s) => s.trim());
  return listed.includes(`${story.id}/${sceneId}`);
}
```

`routes/stories.ts` 的 `createStory`：`if (!scene?.live || …)` 改为 `if (!isOrderable(c.env, story, request.scene) || !story.kinds.includes(request.kind)) return fail(c, "BAD_REQUEST");`。`types.ts` 的 `Bindings` 加 `/** Staging only: "story/scene,…" orderable before going live. */ PREVIEW_SCENES?: string;`。`apps/api/wrangler.jsonc` 的 staging `vars` 加 `"PREVIEW_SCENES": "christmas/snow-cabin,christmas/city-flat,christmas/farmhouse"`（附注释：只在 staging 生效，生产配置不得出现）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint && pnpm --filter @vzc/api dryrun`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(stories): staging can order Christmas scenes before they go live (PREVIEW_SCENES); production cannot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 评测脚本：描述、关键帧、素材、测试站成片、打分

**Files:**
- Create: `eval/src/run-describe.ts`、`eval/src/run-xmas-keyframes.ts`、`eval/src/run-assets.ts`、`eval/src/run-staging-films.ts`、`eval/src/spend.ts`
- Create: `eval/scripts/xmas_face.py`
- Test: `eval/test/xmas.test.ts`
- Modify: `eval/README.md`（加「圣诞评测」一节）

**Interfaces:**
- Consumes: `CHRISTMAS`、`DESCRIBE_PROMPT`、`parseAppearance`、`KieDescriber`、eval 现有的 `kie.ts`/`kie-job.ts`（createTask + 轮询 + 下载）、`personas.ts`、`env.ts`（读 `eval.env`）、`apps/web/scripts/smoke.ts` 的 API 调用方式
- Produces（每个脚本：无 `--yes` 只打印计划与预估花费；有 `--yes` 才调用；开始与结束各查一次 `GET /api/v1/chat/credit`，打印实测花费 =(前−后)×$0.005；所有产物写 `eval/results/<run>/`，已被 git 忽略）：
  - `run-describe.ts --run r0 [--models claude-haiku-5-5,<fallback>]`：12 张人像两两成对（同一对的 survivor/infected），每个模型描述一次，输出 `describe.csv`（pair, model, ok, survivor, infected, dropped）与原始回答 `raw/*.txt`
  - `run-xmas-keyframes.ts --run r1 --scenes snow-cabin,city-flat,farmhouse --pairs p01,p03,p06,p07,p09`：按圣诞步骤顺序直接调 KIE（describe → 第 1 轮 8 张候选 → `xmas_face.py` 挑选 → tree、forgetWarm → embrace），关键帧提示词来自 `CHRISTMAS.keyframes[].prompt(scene, "human", appearance)`；预估 = 对数 × 场景 × 11 × $0.015 + 描述
  - `run-assets.ts --run assets-r1`：生成 `ornament`（2 候选）、`hands` 关键帧（2 候选）+ Kling 5 s、三个场景的 `window` 关键帧（各 2 候选）+ Kling 5 s；提示词常量写在脚本里并随产物写 `prompts.json`；不自动覆盖 `assets/stories/`——由人挑选后再复制
  - `run-staging-films.ts --run r2 --scene snow-cabin --pairs p01,p03,p06 [--api https://api-staging.videozombiecouple.com]`：读 `~/.vzc-secrets/smoke-session-staging` 与 `smoke-staging`（不打印），按 `smoke.ts` 的方式上传两张照片、`POST /v1/stories`（`story: "christmas"`）、`/render`，轮询到 `done`，渲染中收集 `frames`，下载成片、海报与关键帧；**一单接一单**，不并发；预估 = 单数 × $1.92
  - `xmas_face.py <dir>`：对每张关键帧按 `CHRISTMAS` 的 `faces` 计算与原照片的余弦相似度，并用 insightface 的 `gender` 与原照片比对，输出 `faces.csv`（frame, pair, sim_survivor, sim_infected, gender_ok）与汇总（性别画反次数、各帧相似度中位数）；人脸特征只在内存中，不写文件
  - `spend.ts`：`credit()` 与 `estimate()` 小工具，供以上脚本共用

- [ ] **Step 1: 写失败的测试**

`eval/test/xmas.test.ts`（`node --test`）：

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateKeyframes, estimateFilms, planXmasRounds } from "../src/run-xmas-keyframes.ts";

test("round one holds the four scored frames; then tree and forgetWarm; then embrace", () => {
  assert.deepEqual(planXmasRounds(), [
    ["wide", "memory", "forgetCold", "rememberClose"],
    ["tree", "forgetWarm"],
    ["embrace"],
  ]);
});

test("estimates stay inside one round's budget", () => {
  assert.ok(estimateKeyframes({ pairs: 5, scenes: 3 }) < 10);
  assert.ok(estimateFilms(4) < 10);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test eval/test/`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现脚本**

按上面的 Produces 实现；`planXmasRounds()` 由 `CHRISTMAS.keyframes` 的 `refs` 推导（与 API 的步骤图同一规则：只依赖照片/素材的进第 1 轮，依赖第 1 轮帧的进第 2 轮，依此类推）；`estimateKeyframes({pairs, scenes}) = pairs * scenes * 11 * 0.015 + pairs * 0.001`；`estimateFilms(n) = n * 1.92`。所有脚本：

- 只读 `~/.vzc-secrets/eval.env`（KIE）与 `smoke-*`（staging），密钥绝不打印、不写进结果文件；
- 遇 KIE `433`（每小时额度）立即停止并打印「额度已到，等一小时后用 `--resume` 继续」；
- `--resume` 跳过已有产物；
- 结果目录里不写原始人脸特征。

`eval/README.md` 加「圣诞评测」一节：R0–R3 的命令、预算（R0 ≈ $0.05，R1 ≈ $2.5 + 素材 $1.6，R2/R3 各 ≈ $8）、验收标准（引用 spec §5）、结论写入 `docs/model-eval.md`。

- [ ] **Step 4: 跑测试与干跑**

Run: `node --test eval/test/ && node eval/src/run-xmas-keyframes.ts --run r1 && node eval/src/run-staging-films.ts --run r2 --scene snow-cabin --pairs p01,p03,p06 && node eval/src/run-assets.ts --run assets-r1`
Expected: 测试 PASS；三个干跑只打印计划与预估，不发任何请求。

- [ ] **Step 5: Commit**

```bash
git add eval
git commit -m "feat(eval): Christmas eval — describe, keyframes in story order, scene assets, staging films one at a time, face and gender scoring

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B — 内容与评测（控制者在浏览器里执行，和用户确认）

每一步开始前把预估花费告诉用户；超过当轮 $10 时先停下来问。

### Task 8: 即梦定稿（5 组人像）

- [ ] 用 `docs/research/2026-10-15-christmas-jimeng-notes.md` 的流程（JXA 后台标签页、每次新建对话、按提示词文字取记录），把 Task 1 的 7 个关键帧提示词各在 p01、p03、p06、p07、p09 上跑：外貌描述行先手写（模拟 describe 输出）。
- [ ] 每张关键帧至少 3 组通过（认得出、性别对、头巾/胡子/光头保留且不凭空添加、衣服与场景连贯、挂饰唯一）。不通过就改措辞，改动同步到 `christmas.ts`（新开子代理或在下一轮修复里提交，测试同步更新）。
- [ ] 结论追加到 notes 文件；联系表给用户看。

### Task 9: R0 描述评测（≈ $0.05）

- [ ] 部署前本地跑：`node eval/src/run-describe.ts --run r0 --yes`。
- [ ] 验收：12 对 × 2 个模型；格式正确率 ≥ 95%；头巾、胡子、光头、眼镜识别对；清洗后没有任何禁止词；无「描述了照片里没有的头巾/胡子」。不达标则改 `DESCRIBE_PROMPT` 或换备用模型，重跑。
- [ ] 结果写进 `docs/model-eval.md` 圣诞章节。

### Task 10: R1 关键帧 + 场景素材（≈ $4.1）

- [ ] `node eval/src/run-xmas-keyframes.ts --run r1 --yes`，`uv run eval/scripts/xmas_face.py eval/results/r1`。
- [ ] 验收（每个场景）：选中帧性别画反 0；年轻回忆相似度中位数 ≥ 0.6；老年帧交给用户盲看（5 组 ≥ 4 组认得出）；挂饰唯一。
- [ ] `node eval/src/run-assets.ts --run assets-r1 --yes`；和用户一起挑选，复制到 `assets/stories/christmas/shared/{ornament.jpg,hands.mp4}` 与 `assets/stories/christmas/<scene>/window.mp4`；在 `assets/stories/README.md` 逐项写来源（模型、日期、提示词）。提交。

### Task 11: 配乐（$0）

- [ ] 在用户的 Chrome（JXA 后台标签页）打开 suno.com，确认 Pro 订阅有效（续费日 2026-11-14 之前），每个场景生成器乐（风格提示词写进 README：前 10 秒稀疏钢琴、10–13 秒停、13–20 秒钟琴上行与弦乐渐强、20 秒鼓点后主旋律、收在钢琴单音），挑一条。
- [ ] CC0 音效（挂钟、风、地板、纸盒、笑声）从公有领域来源下载，记录链接与许可。
- [ ] ffmpeg 混成 32 s：`loudnorm=I=-16:TP=-1.5`，0:10–0:13 音量压到 −40 dB，0:20 处叠鼓点，结尾 0.6 s 淡出，AAC 160 kbps；存 `assets/stories/christmas/<scene>/music.m4a`；README 记 Suno 歌曲 id、订阅状态、日期与音效来源。提交。

### Task 12: R2、R3 测试站成片与验收（各 ≈ $8）

- [ ] 合并 Part A 与素材后部署到测试站（`PREVIEW_SCENES` 生效、素材经 `deploy.sh` 上传），确认测试账号有足够积分（每单 20）。
- [ ] R2：`node eval/src/run-staging-films.ts --run r2 --scene snow-cabin --pairs p01,p03,p06 --yes`，再 `--scene city-flat --pairs p07 --yes`；R3：`farmhouse` 2 组 + `city-flat` 2 组。
- [ ] 每轮后 `xmas_face.py` 打分；看镜头 1、2、6 是否变形，镜头 5 树灯、镜头 7 白闪；记录每单实测花费（KIE 余额差）与耗时 p90。
- [ ] 验收：spec §5 全部条目；每单模型费 ≤ $2.3；p90 ≤ 10 分钟；用户看 3 条完整样片通过。
- [ ] 结论写进 `docs/model-eval.md` 圣诞章节；把通过验收的成片列为第三份计划的样片候选；提交。
- [ ] 场景保持 `live: false`。

## 交接给第三份计划

- 隐私政策更新（处理方加 Anthropic、Google；读取衣着与发型；仅用于生成；随照片删除）——未更新不得切上线。
- 先跑 `stripe-setup test --yes`/`live --yes` 写入 `christmas1` 价格，再切 `live: true`；生产配置不得出现 `PREVIEW_SCENES`。
- 页面、StoryTool、定价页、`SharedFilm.story`、ledger 文案、阶段标签（此前已列）。
