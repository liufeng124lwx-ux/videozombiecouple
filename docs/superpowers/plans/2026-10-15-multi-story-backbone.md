# 多故事骨架 + 「50 Christmases」数据 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把写死的丧尸故事改成 catalog 里的「故事数据」，生成流程、扣费、合成都按故事走；加入圣诞故事「50 Christmases」的数据（提示词为初稿）与 `christmas1` 商品，丧尸片行为完全不变。

**Architecture:** `packages/catalog/src/stories/` 定义 `Story` 类型、注册表与结构校验；`zombie.ts` 把现有 `story.ts` 包装成 `Story`（不搬动、不改提示词），`christmas.ts` 是新故事。API 的 `graph.ts` 按故事的关键帧引用自动排出步骤与依赖；`StorySpec.story` 记录故事（旧记录缺省为 zombie）。composer 新增调色、中途叠字、白闪、可配置的末帧停留与字幕卡时间，新字段全部可选、缺省等于现状。

**Tech Stack:** TypeScript（pnpm workspace，vitest，Hono on Workers，Durable Objects，D1），Python 3.12（FastAPI，ffmpeg，Pillow，pytest，uv）。

**Spec:** `docs/superpowers/specs/2026-10-15-christmas-story-design.md`（上级：`docs/superpowers/specs/2026-10-14-videozombiecouple-design.md`）

**范围说明：** 这是三份计划中的第一份。第二份（即梦调提示词、场景素材与音轨、`eval/` 评测）和第三份（`/ai-christmas-video` 页面、定价页、Stripe 商品上线、样片）另写。本计划结束时：圣诞故事能在测试里用假模型跑通 32 秒成片流程，但三个圣诞场景都是 `live: false`，线上还下不了单。

**分支：** 从当前 HEAD 新建 `feat/christmas-story`。

## Global Constraints

- 先写失败的测试，再写实现（CLAUDE.md）。
- 页面与接口里的数字只从 `packages/catalog` 读（CLAUDE.md）。
- 本计划不调用 KIE；提示词只写初稿，定稿在第二份计划里用即梦调（记忆：tune prompts in 即梦, never by calling KIE）。
- KIE 密钥只在 `~/.vzc-secrets/` 和 wrangler secret 里；绝不打印、写日志或提交。
- 丧尸片行为不变：同样的提示词、分镜、步骤 id 与依赖、扣 10 积分、15 秒成片、合成参数缺省值不变。
- 圣诞片：扣 20 积分；正片 30 秒 + 字幕卡叠在最后一镜上，总长 32 秒；只支持 `human`；三个场景 `snow-cabin`、`city-flat`、`farmhouse`。
- 支付费率（Stripe Managed Payments，保守值）：卡费 2.9% + $0.30，Managed Payments 3.5%，国际卡 1.5%，合计 `rate = 0.079`、`fixedUsd = 0.3`。
- 毛利：每个故事、每个能买它的商品，净收入 ≥ 2 × 全成本（全成本 = 模型费 × 1.3 + $0.30）。
- 字幕卡整体淡入（规格里「第二行延迟 1 秒淡入」本计划不做，作为简化）。
- 提交信息格式沿用仓库：`feat(scope): …`，结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 每个任务结束跑：`pnpm lint`、`pnpm typecheck`、受影响包的测试；Python 任务跑 `cd apps/composer && uv run pytest -q`。

## Review Focus

1. **部署前已在跑的丧尸单**（DO 里的状态没有 `story` 字段、步骤叫 `score:AC`）必须照常跑完 → Task 6 加测试。
2. **只有 10 积分（一条丧尸片）的人下圣诞单** → `CREDITS_LOW`，不扣任何积分 → Task 6 加测试。
3. **圣诞单中途失败** → 退回的是 20 积分，不是 10 → Task 6 加测试。
4. **下单时传了不上线的场景、别的故事的场景、或圣诞片的 `pet`** → `BAD_REQUEST`，不建单 → Task 4 加测试。
5. **日期没写年份（如 "Dec 24"）或没填** → 字幕卡年份用下单当年，不出现 `undefined` → Task 2 加测试。

---

### Task 1: Story 类型、丧尸故事包装、注册表与结构校验

**Files:**
- Create: `packages/catalog/src/stories/types.ts`
- Create: `packages/catalog/src/stories/zombie.ts`
- Create: `packages/catalog/src/stories/length.ts`
- Create: `packages/catalog/src/stories/validate.ts`
- Create: `packages/catalog/src/stories/index.ts`
- Modify: `packages/catalog/src/index.ts`
- Test: `packages/catalog/test/stories.test.ts`

**Interfaces:**
- Consumes: `story.ts` 现有导出（`keyframePrompt`、`shotPrompt`、`storyboard`、`SCENES`、`CANDIDATES_PER_FRAME`、`CAPTION_SEC`、`Grade`、`Kind`、`SceneId`）。
- Produces:
  - `type StoryId = "zombie"`（Task 2 扩成 `"zombie" | "christmas"`）、`STORY_IDS`
  - `type Role = "survivor" | "infected"`、`type FrameRef`、`type StoryKeyframe`、`type StoryShot`、`type StoryScene`、`type StoryTitle`、`type Story`（定义见 Step 3）
  - `ZOMBIE: Story`、`CAPTION_LINE1: string`
  - `STORIES: Record<StoryId, Story>`、`storyOf(spec: { story?: StoryId }): Story`、`sceneLabel(scene: string): string`、`totalSeconds(story: Story, kind: Kind): number`
  - `validateStory(story: Story): string[]`（空数组 = 合法）

- [ ] **Step 1: 写失败的测试**

`packages/catalog/test/stories.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  KINDS,
  keyframePrompt,
  SCENE_IDS,
  SCENES,
  STORIES,
  STORYBOARD,
  sceneLabel,
  shotPrompt,
  storyboard,
  storyOf,
  totalSeconds,
  validateStory,
  ZOMBIE,
} from "../src/index.ts";

describe("the zombie story as data", () => {
  it("keeps every keyframe prompt of story.ts, in the order A, C, B", () => {
    expect(ZOMBIE.keyframes.map((k) => k.id)).toEqual(["A", "C", "B"]);
    for (const scene of SCENE_IDS)
      for (const kind of KINDS)
        for (const k of ZOMBIE.keyframes)
          expect(k.prompt(scene, kind)).toBe(keyframePrompt(scene, k.id as "A" | "B" | "C", kind));
  });

  it("scores two candidates of A and C; B is one image from the photos, A and C", () => {
    const [a, c, b] = ZOMBIE.keyframes;
    expect([a?.candidates, c?.candidates, b?.candidates]).toEqual([
      CANDIDATES_PER_FRAME,
      CANDIDATES_PER_FRAME,
      1,
    ]);
    expect(b?.refs).toEqual([
      { photo: "survivor" },
      { photo: "infected" },
      { frame: "A" },
      { frame: "C" },
    ]);
    expect(a?.faces).toEqual(["infected"]);
    expect(c?.faces).toEqual(["survivor", "infected"]);
    expect([a?.petFaces, c?.petFaces, b?.petFaces]).toEqual([[], ["survivor"], ["survivor"]]);
  });

  it("keeps the storyboard and shot prompts for both kinds", () => {
    for (const kind of KINDS) {
      const legacy = storyboard(kind);
      const shots = ZOMBIE.storyboard(kind);
      expect(shots.map((s) => [s.id, s.sec, s.first, s.last, s.grade])).toEqual(
        legacy.map((s) => [
          s.id,
          s.targetSec,
          { frame: s.first },
          s.last ? { frame: s.last } : undefined,
          s.grade,
        ]),
      );
      for (const scene of SCENE_IDS)
        for (const s of shots) expect(s.prompt?.(scene, kind)).toBe(shotPrompt(scene, s.id as 1, kind));
    }
  });

  it("is 15 seconds with the held title, no overlays, the old end title", () => {
    expect(totalSeconds(ZOMBIE, "human")).toBe(
      STORYBOARD.reduce((t, s) => t + s.targetSec, 0) + CAPTION_SEC,
    );
    expect(ZOMBIE.overlays).toEqual([]);
    expect(ZOMBIE.titleAt).toBeNull();
    expect(ZOMBIE.credits).toBe(10);
    expect(ZOMBIE.title({ names: "Tom & Amy", date: "2019", createdAt: 0 })).toEqual({
      line1: "Even at the end of the world.",
      line2: "Tom & Amy · 2019",
      line3: null,
    });
    expect(ZOMBIE.title({ names: null, date: null, createdAt: 0 }).line2).toBeNull();
  });

  it("has the same scenes and music", () => {
    for (const id of SCENE_IDS)
      expect(ZOMBIE.scenes[id]).toEqual({
        id,
        label: SCENES[id].label,
        live: SCENES[id].live,
        musicKey: SCENES[id].musicKey,
        assets: {},
      });
  });
});

describe("the story registry", () => {
  it("finds a story, and old records without one are zombie films", () => {
    expect(storyOf({})).toBe(ZOMBIE);
    expect(storyOf({ story: "zombie" })).toBe(ZOMBIE);
    expect(sceneLabel("cabin-wheat")).toBe(SCENES["cabin-wheat"].label);
    expect(sceneLabel("nowhere")).toBe("nowhere");
  });

  it("every story is well formed", () => {
    for (const story of Object.values(STORIES)) expect(validateStory(story), story.id).toEqual([]);
  });

  it("the validator catches a missing frame, a forward reference and an unknown asset", () => {
    const broken = {
      ...ZOMBIE,
      keyframes: [
        { ...ZOMBIE.keyframes[2], id: "B" },
        { ...ZOMBIE.keyframes[0], id: "A", refs: [{ asset: "ornament" }] },
      ],
    } as typeof ZOMBIE;
    const errors = validateStory(broken);
    expect(errors.join("\n")).toMatch(/keyframe B refers to A before it is made/);
    expect(errors.join("\n")).toMatch(/keyframe B refers to unknown frame C/);
    expect(errors.join("\n")).toMatch(/asset "ornament" missing in scene cabin-wheat/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/catalog test -- stories`
Expected: FAIL，`ZOMBIE` / `STORIES` 等未导出。

- [ ] **Step 3: 写类型**

`packages/catalog/src/stories/types.ts`：

```ts
import type { Grade, Kind } from "../story.ts";

export const STORY_IDS = ["zombie"] as const;
export type StoryId = (typeof STORY_IDS)[number];

/** survivor = photo 1 (survivorKey), infected = photo 2 (infectedKey); names kept from the zombie story. */
export type Role = "survivor" | "infected";

/** Where a reference image comes from: a user photo, another keyframe of this film, or a scene asset. */
export type FrameRef = { photo: Role } | { frame: string } | { asset: string };

export type StoryKeyframe = {
  id: string;
  /** In prompt order: the first ref is IMAGE 1. A frame may only refer to keyframes listed before it. */
  refs: readonly FrameRef[];
  /** 2 or more: the candidates are scored and the best becomes the frame. */
  candidates: number;
  /** Faces compared when scoring, for people and for the pet version. */
  faces: readonly Role[];
  petFaces: readonly Role[];
  prompt(scene: string, kind: Kind): string;
};

export type StoryShot = {
  id: number;
  sec: number;
  /** clip: a finished scene video (an asset), made once per scene; no model call. */
  first: { frame: string } | { clip: string };
  last?: { frame: string };
  grade: Grade;
  /** A few white frames at the cut into this shot. */
  flash?: boolean;
  /** Absent only on clip shots. */
  prompt?(scene: string, kind: Kind): string;
};

export type StoryScene = {
  id: string;
  label: string;
  /** Orderable once its prompts passed the eval. */
  live: boolean;
  /** Key under assets/ in R2. */
  musicKey: string;
  /** Asset name → key under assets/ in R2 (images for {asset}, videos for {clip}). */
  assets: Readonly<Record<string, string>>;
};

export type StoryTitle = { line1: string; line2: string | null; line3: string | null };

export type Story = {
  id: StoryId;
  /** Credits one finished film costs. */
  credits: number;
  kinds: readonly Kind[];
  scenes: Readonly<Record<string, StoryScene>>;
  keyframes: readonly StoryKeyframe[];
  storyboard(kind: Kind): StoryShot[];
  /** Text laid over the film between start and end (seconds from the start). */
  overlays: readonly { text: string; start: number; end: number }[];
  title(v: { names: string | null; date: string | null; createdAt: number }): StoryTitle;
  /** Seconds the last frame is held after the last shot. */
  holdSec: number;
  /** Second at which the end title starts fading in; null = the composer's default. */
  titleAt: number | null;
};
```

- [ ] **Step 4: 写丧尸包装**

`packages/catalog/src/stories/zombie.ts`：

```ts
import {
  CANDIDATES_PER_FRAME,
  CAPTION_SEC,
  type FrameId,
  keyframePrompt,
  SCENES,
  type SceneId,
  type ShotId,
  shotPrompt,
  storyboard,
} from "../story.ts";
import type { FrameRef, Story } from "./types.ts";

/** The end title's first line (spec §5.1). */
export const CAPTION_LINE1 = "Even at the end of the world.";

const PHOTOS: FrameRef[] = [{ photo: "survivor" }, { photo: "infected" }];
const scene = (id: string) => id as SceneId;
const frame = (id: FrameId) => (s: string, kind: Parameters<typeof keyframePrompt>[2]) =>
  keyframePrompt(scene(s), id, kind);

/** story.ts wrapped as data: same prompts, storyboard, scenes and title. */
export const ZOMBIE: Story = {
  id: "zombie",
  credits: 10,
  kinds: ["human", "pet"],
  scenes: Object.fromEntries(
    Object.values(SCENES).map((s) => [
      s.id,
      { id: s.id, label: s.label, live: s.live, musicKey: s.musicKey, assets: {} },
    ]),
  ),
  keyframes: [
    {
      id: "A",
      refs: PHOTOS,
      candidates: CANDIDATES_PER_FRAME,
      faces: ["infected"],
      petFaces: [],
      prompt: frame("A"),
    },
    {
      id: "C",
      refs: PHOTOS,
      candidates: CANDIDATES_PER_FRAME,
      faces: ["survivor", "infected"],
      petFaces: ["survivor"],
      prompt: frame("C"),
    },
    {
      id: "B",
      refs: [...PHOTOS, { frame: "A" }, { frame: "C" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: ["survivor"],
      prompt: frame("B"),
    },
  ],
  storyboard: (kind) =>
    storyboard(kind).map((s) => ({
      id: s.id,
      sec: s.targetSec,
      first: { frame: s.first },
      ...(s.last ? { last: { frame: s.last } } : {}),
      grade: s.grade,
      prompt: (sc: string, k: typeof kind) => shotPrompt(scene(sc), s.id as ShotId, k),
    })),
  overlays: [],
  title: ({ names, date }) => ({
    line1: CAPTION_LINE1,
    line2: names && date ? `${names} · ${date}` : (names ?? date),
    line3: null,
  }),
  holdSec: CAPTION_SEC,
  titleAt: null,
};
```

- [ ] **Step 5: 写校验**

`packages/catalog/src/stories/length.ts`：

```ts
import type { Kind } from "../story.ts";
import type { Story } from "./types.ts";

/** Film length: every shot plus the held last frame. */
export function totalSecondsOf(story: Story, kind: Kind): number {
  return story.storyboard(kind).reduce((t, s) => t + s.sec, 0) + story.holdSec;
}
```

`packages/catalog/src/stories/validate.ts`：

```ts
import { KINDS } from "../story.ts";
import { totalSecondsOf } from "./length.ts";
import type { Story } from "./types.ts";

/** Problems with a story's data; empty when it is well formed. */
export function validateStory(story: Story): string[] {
  const errors: string[] = [];
  const order = story.keyframes.map((k) => k.id);
  if (new Set(order).size !== order.length) errors.push("duplicate keyframe ids");
  if (story.credits <= 0) errors.push("credits must be positive");
  if (story.kinds.length === 0) errors.push("no kinds");
  const assetsUsed = new Set<string>();
  story.keyframes.forEach((k, i) => {
    if (k.candidates < 1) errors.push(`keyframe ${k.id} needs at least one image`);
    for (const ref of k.refs) {
      if ("asset" in ref) assetsUsed.add(ref.asset);
      if (!("frame" in ref)) continue;
      const at = order.indexOf(ref.frame);
      if (at === -1) errors.push(`keyframe ${k.id} refers to unknown frame ${ref.frame}`);
      else if (at >= i) errors.push(`keyframe ${k.id} refers to ${ref.frame} before it is made`);
    }
  });
  for (const kind of KINDS.filter((k) => story.kinds.includes(k))) {
    const shots = story.storyboard(kind);
    if (new Set(shots.map((s) => s.id)).size !== shots.length) errors.push(`${kind}: duplicate shot ids`);
    for (const s of shots) {
      if (s.sec <= 0) errors.push(`${kind}: shot ${s.id} has no length`);
      if ("clip" in s.first) assetsUsed.add(s.first.clip);
      else if (!order.includes(s.first.frame))
        errors.push(`${kind}: shot ${s.id} starts on unknown frame ${s.first.frame}`);
      if (s.last && !order.includes(s.last.frame))
        errors.push(`${kind}: shot ${s.id} ends on unknown frame ${s.last.frame}`);
      if (!("clip" in s.first) && !s.prompt) errors.push(`${kind}: shot ${s.id} has no prompt`);
    }
    const total = totalSecondsOf(story, kind);
    for (const o of story.overlays)
      if (o.start < 0 || o.end <= o.start || o.end > total)
        errors.push(`${kind}: overlay "${o.text}" is outside the film`);
    if (story.titleAt !== null && (story.titleAt < 0 || story.titleAt >= total))
      errors.push(`${kind}: the title starts outside the film`);
  }
  for (const sc of Object.values(story.scenes))
    for (const name of assetsUsed)
      if (!sc.assets[name]) errors.push(`asset "${name}" missing in scene ${sc.id}`);
  return errors;
}
```

- [ ] **Step 6: 写注册表并导出**

`packages/catalog/src/stories/index.ts`：

```ts
import type { Story, StoryId } from "./types.ts";
import { ZOMBIE } from "./zombie.ts";

export * from "./types.ts";
export { CAPTION_LINE1, ZOMBIE } from "./zombie.ts";

export const STORIES: Readonly<Record<StoryId, Story>> = { zombie: ZOMBIE };

/** The story of a film; records made before stories existed are zombie films. */
export function storyOf(spec: { story?: StoryId }): Story {
  return STORIES[spec.story ?? "zombie"];
}

/** A scene's label in any story; unknown ids are shown as they are. */
export function sceneLabel(scene: string): string {
  for (const story of Object.values(STORIES)) {
    const found = story.scenes[scene];
    if (found) return found.label;
  }
  return scene;
}

export { totalSecondsOf, totalSecondsOf as totalSeconds } from "./length.ts";
export { validateStory } from "./validate.ts";
```

在 `packages/catalog/src/index.ts` 末尾加一行：

```ts
export * from "./stories/index.ts";
```

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm --filter @vzc/catalog test && pnpm --filter @vzc/catalog typecheck`
Expected: 全部 PASS（`stories.test.ts` 与原有测试）。

- [ ] **Step 8: Commit**

```bash
git add packages/catalog/src/stories packages/catalog/src/index.ts packages/catalog/test/stories.test.ts
git commit -m "feat(catalog): stories as data — the zombie story wrapped unchanged, a registry and a validator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 圣诞故事数据（提示词初稿）

**Files:**
- Create: `packages/catalog/src/stories/christmas.ts`
- Modify: `packages/catalog/src/stories/types.ts`（`STORY_IDS` 加 `"christmas"`）
- Modify: `packages/catalog/src/stories/index.ts`（注册 `CHRISTMAS`）
- Modify: `packages/catalog/src/story.ts`（`Grade` 加 `"amber" | "golden" | "amber-dawn"`）
- Test: `packages/catalog/test/christmas.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Story`、`FrameRef`、`validateStory`、`totalSeconds`。
- Produces: `CHRISTMAS: Story`；`StoryId = "zombie" | "christmas"`；`Grade = "cold" | "warm" | "dawn" | "amber" | "golden" | "amber-dawn"`；关键帧 id `wide`、`memory`、`forgetCold`、`rememberClose`、`tree`、`forgetWarm`、`embrace`；场景素材名 `ornament`（图）、`hands`、`window`（视频）。

- [ ] **Step 1: 写失败的测试**

`packages/catalog/test/christmas.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { CHRISTMAS, STORIES, storyOf, totalSeconds, validateStory } from "../src/index.ts";

describe("50 Christmases", () => {
  it("is well formed, 32 seconds, 20 credits, people only, not orderable yet", () => {
    expect(validateStory(CHRISTMAS)).toEqual([]);
    expect(totalSeconds(CHRISTMAS, "human")).toBe(32);
    expect(CHRISTMAS.credits).toBe(20);
    expect(CHRISTMAS.kinds).toEqual(["human"]);
    expect(Object.keys(CHRISTMAS.scenes)).toEqual(["snow-cabin", "city-flat", "farmhouse"]);
    expect(Object.values(CHRISTMAS.scenes).every((s) => !s.live)).toBe(true);
    expect(STORIES.christmas).toBe(CHRISTMAS);
    expect(storyOf({ story: "christmas" })).toBe(CHRISTMAS);
  });

  it("follows the storyboard: hook first, the hands and the window are scene clips", () => {
    const shots = CHRISTMAS.storyboard("human");
    expect(shots.map((s) => s.sec)).toEqual([3, 3, 4, 3, 4, 3, 4, 4, 4]);
    expect(shots.map((s) => ("clip" in s.first ? `clip:${s.first.clip}` : s.first.frame))).toEqual([
      "forgetCold",
      "rememberClose",
      "wide",
      "clip:hands",
      "tree",
      "forgetWarm",
      "memory",
      "embrace",
      "clip:window",
    ]);
    expect(shots.map((s) => s.grade)).toEqual([
      "cold",
      "cold",
      "cold",
      "cold",
      "cold",
      "amber",
      "golden",
      "amber-dawn",
      "amber-dawn",
    ]);
    expect(shots.filter((s) => s.flash).map((s) => s.id)).toEqual([7]);
  });

  it("scores the wide shot and the memory; everything else builds on the wide shot", () => {
    const byId = Object.fromEntries(CHRISTMAS.keyframes.map((k) => [k.id, k]));
    expect(byId.wide?.candidates).toBe(2);
    expect(byId.memory?.candidates).toBe(2);
    expect(byId.forgetCold?.refs).toEqual([{ photo: "infected" }, { frame: "wide" }]);
    expect(byId.rememberClose?.refs).toEqual([{ photo: "survivor" }, { frame: "wide" }]);
    expect(byId.forgetWarm?.refs).toEqual([{ photo: "infected" }, { frame: "forgetCold" }]);
    expect(byId.tree?.refs).toContainEqual({ asset: "ornament" });
    expect(byId.memory?.refs).toContainEqual({ asset: "ornament" });
    expect(CHRISTMAS.keyframes.reduce((n, k) => n + k.candidates, 0)).toBe(9);
  });

  it("says the hook and the turn on screen, without guessing anyone's gender", () => {
    expect(CHRISTMAS.overlays).toEqual([
      { text: "Our 50th Christmas. Today, you asked me my name.", start: 0, end: 5 },
      { text: "So I brought back our first one.", start: 10, end: 13 },
    ]);
    for (const o of CHRISTMAS.overlays) expect(o.text).not.toMatch(/\b(she|he|her|his|him)\b/i);
    expect(CHRISTMAS.holdSec).toBe(0);
    expect(CHRISTMAS.titleAt).toBe(30);
  });

  it("puts the year of the date on the end title, else the year the film was ordered", () => {
    const at = Date.UTC(2026, 11, 1);
    expect(CHRISTMAS.title({ names: "Tom & Amy", date: "Dec 24, 2019", createdAt: at })).toEqual({
      line1: "Our first Christmas · 2019",
      line2: "and every one after.",
      line3: "Tom & Amy",
    });
    expect(CHRISTMAS.title({ names: null, date: "Dec 24", createdAt: at }).line1).toBe(
      "Our first Christmas · 2026",
    );
    expect(CHRISTMAS.title({ names: null, date: null, createdAt: at })).toEqual({
      line1: "Our first Christmas · 2026",
      line2: "and every one after.",
      line3: null,
    });
  });

  it("every prompt keeps people recognizable and avoids what the models do badly", () => {
    for (const scene of Object.keys(CHRISTMAS.scenes)) {
      for (const k of CHRISTMAS.keyframes) {
        const p = k.prompt(scene, "human");
        expect(p, k.id).toContain("No text, no glasses, no exaggerated crying, no distorted hands.");
        if (k.id !== "memory") expect(p, k.id).toMatch(/aged to about 78/);
        else expect(p).not.toMatch(/aged/);
      }
      for (const s of CHRISTMAS.storyboard("human"))
        if (s.prompt) expect(s.prompt(scene, "human")).toContain("Faces stay consistent with the reference people.");
    }
    expect(CHRISTMAS.keyframes[0]?.prompt("city-flat", "human")).not.toBe(
      CHRISTMAS.keyframes[0]?.prompt("snow-cabin", "human"),
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/catalog test -- christmas`
Expected: FAIL，`CHRISTMAS` 未导出。

- [ ] **Step 3: 扩展类型**

`packages/catalog/src/story.ts` 把 `Grade` 改成：

```ts
/**
 * Colour grade the composer applies. Zombie: the standoff, the memory, the ending at first light.
 * Christmas: amber lamplight, the golden memory, amber with dawn at the window.
 */
export type Grade = "cold" | "warm" | "dawn" | "amber" | "golden" | "amber-dawn";
```

`packages/catalog/src/stories/types.ts`：

```ts
export const STORY_IDS = ["zombie", "christmas"] as const;
```

- [ ] **Step 4: 写圣诞故事**

`packages/catalog/src/stories/christmas.ts`：

```ts
import type { Kind } from "../story.ts";
import type { FrameRef, Story, StoryScene } from "./types.ts";

// Spec 2026-10-15-christmas-story-design.md §2–§3. First drafts: tuned in 即梦 before they go live.
// survivor = the one who remembers (photo 1), infected = the one who forgets (photo 2).

type Setting = { now: string; memory: string; window: string };

const SETTINGS: Record<string, Setting & { label: string }> = {
  "snow-cabin": {
    label: "Snowy cabin",
    now: "a small wooden cabin living room on Christmas Eve, lamps off, cold blue moonlight from the snow outside through a frosted window, an unlit Christmas tree with a few old ornaments, an armchair by the window",
    memory: "a tiny first apartment on a golden winter afternoon, moving boxes against the wall, a one-metre Christmas tree, two new white enamel mugs on the windowsill",
    window: "a snow-covered wooden cabin at night",
  },
  "city-flat": {
    label: "Old city flat",
    now: "an old city apartment living room on Christmas Eve, lamps off, cold blue light from the snowy street through a tall frosted window, an unlit Christmas tree, an armchair by the window",
    memory: "a Christmas market at golden hour, string lights, wooden stalls, a small tree on a stall table",
    window: "an old brick apartment building on a snowy city street at night",
  },
  farmhouse: {
    label: "Farmhouse",
    now: "a farmhouse living room on Christmas Eve, lamps off, cold blue light from the snowy fields through a frosted window, an unlit Christmas tree, an armchair by the window",
    memory: "a snowy field on a golden afternoon, the young couple beside a small freshly cut Christmas tree",
    window: "a farmhouse alone in snowy fields at night",
  },
};

const asset = (scene: string, name: string) => `stories/christmas/${scene}/${name}`;

const SCENES: Record<string, StoryScene> = Object.fromEntries(
  Object.entries(SETTINGS).map(([id, s]) => [
    id,
    {
      id,
      label: s.label,
      live: false,
      musicKey: asset(id, "music.m4a"),
      assets: {
        ornament: asset(id, "ornament.jpg"),
        hands: asset(id, "hands.mp4"),
        window: asset(id, "window.mp4"),
      },
    },
  ]),
);

const STYLE = "Cinematic film still, vertical 9:16, 35mm film grain.";
const SAFE = "No text, no glasses, no exaggerated crying, no distorted hands.";
const MOTION = "Subtle, restrained motion. Faces stay consistent with the reference people.";
const ORNAMENT = "the red glass heart ornament with a gold ribbon";
const AGED = (n: number) =>
  `aged to about 78, silver-white hair, deep wrinkles at the eyes and forehead, age spots on the hands — but the exact same face shape, features and hairline as IMAGE ${n}, instantly recognizable as the same person`;
const FORGETS_CLOTHES = "a cream cable-knit cardigan, a red and green plaid blanket on the lap";
const REMEMBERS_CLOTHES = "a navy wool sweater over a light shirt collar";

const PHOTOS: FrameRef[] = [{ photo: "survivor" }, { photo: "infected" }];
const s = (scene: string) => {
  const found = SETTINGS[scene];
  if (!found) throw new Error(`unknown christmas scene ${scene}`);
  return found;
};

export const CHRISTMAS: Story = {
  id: "christmas",
  credits: 20,
  kinds: ["human"],
  scenes: SCENES,
  keyframes: [
    {
      id: "wide",
      refs: PHOTOS,
      candidates: 2,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: (scene) =>
        [
          STYLE,
          `${s(scene).now}.`,
          `The person from IMAGE 2, ${AGED(2)}, sits in the armchair by the window in profile, wearing ${FORGETS_CLOTHES}, looking out at the snow.`,
          `The person from IMAGE 1, ${AGED(1)}, stands in the doorway holding two white enamel mugs with chipped rims, wearing ${REMEMBERS_CLOTHES}.`,
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
      prompt: (scene) =>
        [
          STYLE,
          `${s(scene).memory}, warm golden light, soft haze.`,
          "The person from IMAGE 2, exactly as they look in IMAGE 2, wearing a burgundy sweater, rests one hand on the cheek of the person from IMAGE 1, exactly as they look in IMAGE 1, wearing a grey hoodie; both laughing, faces close.",
          `${ORNAMENT} exactly as in IMAGE 3 hangs on the small tree beside them.`,
          "Medium close-up, front three-quarter view.",
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetCold",
      refs: [{ photo: "infected" }, { frame: "wide" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: (scene) =>
        [
          STYLE,
          `Close-up of the person sitting by the window in IMAGE 2, ${AGED(1)}, same clothes, light and room as IMAGE 2 (${s(scene).now}).`,
          "Cold blue window light from the side, the face filling two thirds of the frame, eyes looking out of the window, a distant, empty gaze.",
          "Shallow depth of field.",
          SAFE,
        ].join(" "),
    },
    {
      id: "rememberClose",
      refs: [{ photo: "survivor" }, { frame: "wide" }],
      candidates: 1,
      faces: ["survivor"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          `Close-up of the person standing in the doorway in IMAGE 2, ${AGED(1)}, same clothes and light as IMAGE 2.`,
          "The dark, unlit Christmas tree blurred behind; cold shadows; a glint of moisture in the eyes, a small, sad smile.",
          SAFE,
        ].join(" "),
    },
    {
      id: "tree",
      refs: [...PHOTOS, { frame: "wide" }, { asset: "ornament" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          "The same room, people, clothes and cold light as IMAGE 3.",
          `The person from IMAGE 1, ${AGED(1)}, stands in profile at the unlit Christmas tree, raising ${ORNAMENT} exactly as in IMAGE 4 to a branch at eye level.`,
          `In the soft-focus background, the person from IMAGE 2, ${AGED(2)}, sits in the armchair by the window.`,
          SAFE,
        ].join(" "),
    },
    {
      id: "forgetWarm",
      refs: [{ photo: "infected" }, { frame: "forgetCold" }],
      candidates: 1,
      faces: ["infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          `Exactly the same framing, person, ${AGED(1)}, and clothes as IMAGE 2, but now lit by warm amber Christmas-tree lights.`,
          "The eyes have come into focus and look just off camera at someone they love; tears welling but not falling, lips slightly parted.",
          SAFE,
        ].join(" "),
    },
    {
      id: "embrace",
      refs: [...PHOTOS, { frame: "tree" }],
      candidates: 1,
      faces: ["survivor", "infected"],
      petFaces: [],
      prompt: () =>
        [
          STYLE,
          "The same room and clothes as IMAGE 3, the Christmas tree now fully lit with warm amber lights, pale dawn at the window, snow still falling.",
          `The person from IMAGE 1, ${AGED(1)}, and the person from IMAGE 2, ${AGED(2)}, stand by the tree, foreheads touching, eyes closed, one hand of the person from IMAGE 2 resting on the other's cheek.`,
          "Medium shot.",
          SAFE,
        ].join(" "),
    },
  ],
  storyboard: (_kind: Kind) => [
    {
      id: 1,
      sec: 3,
      first: { frame: "forgetCold" },
      grade: "cold",
      prompt: () =>
        `The person turns their head toward someone just off camera, gives a small polite smile, the kind you give a stranger, then turns back to the window, the gaze empty again. Static camera. ${MOTION}`,
    },
    {
      id: 2,
      sec: 3,
      first: { frame: "rememberClose" },
      grade: "cold",
      prompt: () =>
        `The person's smile falters, the eyes grow wet without tears falling, and they slowly lower their head. Very slow push-in. ${MOTION}`,
    },
    {
      id: 3,
      sec: 4,
      first: { frame: "wide" },
      grade: "cold",
      prompt: () =>
        `The person in the doorway walks slowly to the armchair and gently sets one mug on the small table beside the seated person; steam rises. The seated person keeps looking out of the window. Then the standing person turns to look at the dark Christmas tree. Static camera, slight push-in. ${MOTION}`,
    },
    { id: 4, sec: 3, first: { clip: "hands" }, grade: "cold" },
    {
      id: 5,
      sec: 4,
      first: { frame: "tree" },
      grade: "cold",
      prompt: () =>
        `The ornament is hung on the branch and sways gently. The tree's lights switch on one by one, spreading outward from the ornament, until warm amber light reaches the person in the armchair. Slow lateral camera move from the tree to the armchair. ${MOTION}`,
    },
    {
      id: 6,
      sec: 3,
      first: { frame: "forgetWarm" },
      grade: "amber",
      prompt: () =>
        `The gaze slowly focuses with recognition, tears well up, the lips tremble slightly, and one hand rises out of frame toward the face of the person they love. Static camera. ${MOTION}`,
    },
    {
      id: 7,
      sec: 4,
      first: { frame: "memory" },
      grade: "golden",
      flash: true,
      prompt: () =>
        `Both laugh; the one with the hand on the other's cheek leans in and is kissed on the forehead, eyes closing with a smile. Gentle handheld feel, slow pull back, like a home video. ${MOTION}`,
    },
    {
      id: 8,
      sec: 4,
      first: { frame: "embrace" },
      grade: "amber-dawn",
      prompt: () =>
        `Foreheads touching, eyes closed, they sway slowly from side to side as if dancing. Outside the window the sky turns from blue to pale white. The camera slowly pulls back and rises, revealing the lit tree and two steaming mugs on the windowsill. ${MOTION}`,
    },
    { id: 9, sec: 4, first: { clip: "window" }, grade: "amber-dawn" },
  ],
  overlays: [
    { text: "Our 50th Christmas. Today, you asked me my name.", start: 0, end: 5 },
    { text: "So I brought back our first one.", start: 10, end: 13 },
  ],
  title: ({ names, date, createdAt }) => {
    const year = date?.match(/\b(\d{4})\b/)?.[1] ?? String(new Date(createdAt).getUTCFullYear());
    return {
      line1: `Our first Christmas · ${year}`,
      line2: "and every one after.",
      line3: names,
    };
  },
  holdSec: 0,
  titleAt: 30,
};
```

- [ ] **Step 5: 注册**

`packages/catalog/src/stories/index.ts`：

```ts
import { CHRISTMAS } from "./christmas.ts";
// …
export { CHRISTMAS } from "./christmas.ts";

export const STORIES: Readonly<Record<StoryId, Story>> = { zombie: ZOMBIE, christmas: CHRISTMAS };
```

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @vzc/catalog test && pnpm typecheck`
Expected: PASS。`pnpm typecheck` 若在 `apps/api` 或 `apps/composer` 客户端里报 `Grade` 穷举（如 `switch`）不全，补上新值再跑。

- [ ] **Step 7: Commit**

```bash
git add packages/catalog
git commit -m "feat(catalog): 50 Christmases — keyframes, storyboard, overlays and end title as data (draft prompts, not live)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 按故事算成本与毛利、Stripe 费率、`christmas1` 商品、facts

**Files:**
- Modify: `packages/catalog/src/plans.ts`
- Modify: `packages/catalog/src/pricing.ts`
- Modify: `packages/catalog/src/facts.ts`
- Modify: `apps/web/src/lib/pricing-view.ts`（只换成 `VIDEO_PACKS`）
- Modify: `scripts/stripe-setup.ts`（商品名用 `label`）
- Test: `packages/catalog/test/pricing.test.ts`、`packages/catalog/test/facts.test.ts`、`packages/catalog/test/story.test.ts`

**Interfaces:**
- Consumes: `STORIES`、`ZOMBIE`、`CHRISTMAS`、`Story`、`StoryId`。
- Produces:
  - `Pack` 加 `story?: StoryId; label?: string`；`VIDEO_PACKS`（不带 `story` 的包）；`Product` 的 pack 分支加 `label?: string`
  - `PAYMENT_FEE = { rate: 0.079, fixedUsd: 0.3 }`（替换 `WAFFO_FEE`）
  - `netPerCreditUsd(pack: Pack): number`、`netPerVideoUsd(pack: Pack): number`（= 每积分 × `TIERS.video.credits`）
  - `storyCostUsd(routes?, story?: Story): { video: number }`、`filmCostUsd(routes?, story?: Story): number`
  - `pricingGuard(routes?, packs?, stories?)` 返回 `{ rule: "video_margin"; story: StoryId; pack: string; revenueUsd: number; costUsd: number }[]`
  - facts：`story.zombie.seconds`、`story.christmas.seconds`、`story.christmas.usd`、`story.christmas.credits`

- [ ] **Step 1: 改测试（先失败）**

`packages/catalog/test/pricing.test.ts` 整体替换为：

```ts
import { describe, expect, it } from "vitest";
import {
  CHRISTMAS,
  filmCostUsd,
  minCreditPrice,
  netPerCreditUsd,
  netPerVideoUsd,
  PACKS,
  PAYMENT_FEE,
  PRODUCTS,
  pricingGuard,
  productByKey,
  ROUTES,
  SALE_PRODUCTS,
  storyCostUsd,
  VIDEO_PACKS,
  ZOMBIE,
} from "../src/index.ts";

const synthetic = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "keyframe" ? 0.1 : 1 }));

describe("pricing (spec §7, christmas spec §6)", () => {
  it("finds the cheapest credit in the 5-video pack", () => {
    expect(minCreditPrice()).toBeCloseTo(21.99 / 50, 6);
  });

  it("makes bigger video packs cheaper per video", () => {
    const perVideo = VIDEO_PACKS.map((p) => (p.usd / p.credits) * 10);
    expect([...perVideo].sort((a, b) => b - a)).toEqual(perVideo);
  });

  it("sells the video packs and one Christmas film, findable by product key", () => {
    expect(SALE_PRODUCTS.map((p) => p.key)).toEqual(["pack1", "pack3", "pack5", "christmas1"]);
    expect(productByKey("christmas1")).toMatchObject({ kind: "pack", credits: 20, usd: 9.99 });
    expect(VIDEO_PACKS.map((p) => p.id)).toEqual(["pack1", "pack3", "pack5"]);
    expect(PACKS.find((p) => p.id === "christmas1")?.story).toBe("christmas");
    expect(PRODUCTS.some((p) => p.kind === "plan")).toBe(true);
  });

  it("a zombie film is four candidates, B and five 3-second shots", () => {
    expect(storyCostUsd(synthetic).video).toBeCloseTo(5.5);
    expect(storyCostUsd(synthetic, ZOMBIE).video).toBeCloseTo(5.5);
  });

  it("a Christmas film is nine keyframes and 25 seconds of shots; clips cost nothing", () => {
    // 9 × 0.1 + (3+3+4+4+3+4+4)/3 × 1
    expect(storyCostUsd(synthetic, CHRISTMAS).video).toBeCloseTo(0.9 + 25 / 3, 6);
  });

  it("nets each pack after Stripe's fees (worst case 7.9% + $0.30)", () => {
    expect(PAYMENT_FEE).toEqual({ rate: 0.079, fixedUsd: 0.3 });
    const pack1 = PACKS[0];
    if (!pack1) throw new Error("no pack1");
    expect(netPerVideoUsd(pack1)).toBeCloseTo((4.99 * 0.921 - 0.3) / 1, 3);
    const xmas = PACKS.find((p) => p.id === "christmas1");
    if (!xmas) throw new Error("no christmas1");
    expect(netPerCreditUsd(xmas) * 20).toBeCloseTo(9.99 * 0.921 - 0.3, 3);
  });

  it("counts free remakes and testing in the cost of a film", () => {
    expect(filmCostUsd()).toBeCloseTo(1.125 * 1.3 + 0.3, 3);
    expect(filmCostUsd(ROUTES, CHRISTMAS)).toBeCloseTo(storyCostUsd(ROUTES, CHRISTMAS).video * 1.3 + 0.3, 6);
  });

  it("refuses a pack that nets less than twice the full cost, per story", () => {
    const cheap = [...PACKS, { id: "pack10", credits: 100, usd: 19.99, productKey: "pack10" }];
    const found = pricingGuard(ROUTES, cheap).map((v) => `${v.story}:${v.pack}`);
    expect(found).toContain("zombie:pack10");
    expect(found).toContain("christmas:pack10");
    expect(pricingGuard()).toEqual([]);
  });

  it("flags every story when shots get expensive", () => {
    const pricey = ROUTES.map((r) => ({ ...r, costUsd: r.capability === "shot" ? 1 : r.costUsd }));
    const stories = new Set(pricingGuard(pricey).map((v) => v.story));
    expect(stories).toEqual(new Set(["zombie", "christmas"]));
  });
});
```

`packages/catalog/test/facts.test.ts` 的 `knows the story numbers` 里加：

```ts
    expect(fact("story.zombie.seconds")).toBe("15");
    expect(fact("story.christmas.seconds")).toBe("32");
    expect(fact("story.christmas.usd")).toBe("$9.99");
    expect(fact("story.christmas.credits")).toBe("20");
    expect(() => fact("pack.christmas1.videos")).toThrow();
```

`packages/catalog/test/story.test.ts` 的 `only video packs are sold…` 改为断言 `VIDEO_PACKS`（把 `PACKS` 换成 `VIDEO_PACKS` 并从 import 里改名），其余不动。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/catalog test`
Expected: FAIL（`VIDEO_PACKS`、`PAYMENT_FEE`、`netPerCreditUsd` 未定义）。

- [ ] **Step 3: 改 plans.ts**

```ts
import type { StoryId } from "./stories/types.ts";

export type Pack = {
  id: string;
  credits: number;
  usd: number;
  productKey: string;
  badge?: "popular";
  /** Sold on that story's page only (not in the video pack list). */
  story?: StoryId;
  /** Product name at checkout when "N videos" would be wrong. */
  label?: string;
};

/** Spec §7: one-time video packs (10 credits = 1 video); credits never expire. Prices: owner, 2026-10-15. */
export const PACKS: readonly Pack[] = [
  { id: "pack1", credits: 10, usd: 4.99, productKey: "pack1" },
  { id: "pack3", credits: 30, usd: 13.99, productKey: "pack3", badge: "popular" },
  { id: "pack5", credits: 50, usd: 21.99, productKey: "pack5" },
  // Christmas spec §1.3: one Christmas film, $9.99 (owner, 2026-10-15).
  {
    id: "christmas1",
    credits: 20,
    usd: 9.99,
    productKey: "christmas1",
    story: "christmas",
    label: "1 Christmas film (50 Christmases)",
  },
];

/** The packs on the pricing page's video list and in per-video prices. */
export const VIDEO_PACKS: readonly Pack[] = PACKS.filter((p) => !p.story);
```

`Product` 的 pack 分支改为 `| { kind: "pack"; key: string; credits: number; usd: number; label?: string }`，`PRODUCTS` 里 `PACKS.map` 增加 `...(pack.label ? { label: pack.label } : {})`。

- [ ] **Step 4: 改 pricing.ts**

```ts
import { PACKS, type Pack, PLAN_IDS, PLANS, SELL_PLANS } from "./plans.ts";
import { ROUTES, type RouteSeed } from "./routes.ts";
import { STORIES, type Story, type StoryId, ZOMBIE } from "./stories/index.ts";
import { TIERS } from "./tiers.ts";

// creditPrices / minCreditPrice / MARGIN_FACTOR / primary: unchanged.

/** A route's cost is for the seconds pickSeconds asks for: 3 s at least on the default video route. */
const SHOT_BASE_SEC = 3;

/** Model cost of one paid film on the primary routes: every keyframe image and every non-clip shot. */
export function storyCostUsd(
  routes: readonly RouteSeed[] = ROUTES,
  story: Story = ZOMBIE,
): { video: number } {
  const keyframe = primary(routes, "keyframe");
  const shot = primary(routes, "shot");
  const images = story.keyframes.reduce((n, k) => n + k.candidates, 0);
  const shotSec = story
    .storyboard("human")
    .filter((s) => !("clip" in s.first))
    .reduce((t, s) => t + Math.max(s.sec, SHOT_BASE_SEC) / SHOT_BASE_SEC, 0);
  return { video: keyframe * images + shot * shotSec };
}

/**
 * Stripe Managed Payments (merchant of record): card 2.9% + $0.30, Managed Payments 3.5%,
 * international cards 1.5% more. The worst case is used for the margin check.
 */
export const PAYMENT_FEE = { rate: 0.079, fixedUsd: 0.3 } as const; // 2.9% + 3.5% + 1.5%
/** Share of paid films we expect to be remade once for free (owner's assumption, 2026-10-15). */
export const REMAKE_RATE = 0.3;
/** Evals, example films and staging runs, spread over each paid film (≈ $30 a month at 100 films). */
export const TESTING_PER_FILM_USD = 0.3;

/** What one credit of a pack brings in after the payment fees. */
export function netPerCreditUsd(pack: Pack): number {
  return (pack.usd * (1 - PAYMENT_FEE.rate) - PAYMENT_FEE.fixedUsd) / pack.credits;
}

/** What one zombie video (TIERS.video.credits) of a pack brings in after the fees. */
export function netPerVideoUsd(pack: Pack): number {
  return netPerCreditUsd(pack) * TIERS.video.credits;
}

/** The full cost of one paid film: models, the expected free remakes and testing. */
export function filmCostUsd(routes: readonly RouteSeed[] = ROUTES, story: Story = ZOMBIE): number {
  return storyCostUsd(routes, story).video * (1 + REMAKE_RATE) + TESTING_PER_FILM_USD;
}

export type GuardViolation = {
  rule: "video_margin";
  story: StoryId;
  pack: string;
  revenueUsd: number;
  costUsd: number;
};

/** Every pack that can buy a story must net at least MARGIN_FACTOR times that film's full cost. */
export function pricingGuard(
  routes: readonly RouteSeed[] = ROUTES,
  packs: readonly Pack[] = PACKS,
  stories: readonly Story[] = Object.values(STORIES),
): GuardViolation[] {
  return stories.flatMap((story) => {
    const costUsd = filmCostUsd(routes, story);
    return packs
      .filter((pack) => !pack.story || pack.story === story.id)
      .flatMap((pack) => {
        const revenueUsd = netPerCreditUsd(pack) * story.credits;
        return revenueUsd < costUsd * MARGIN_FACTOR
          ? [{ rule: "video_margin" as const, story: story.id, pack: pack.id, revenueUsd, costUsd }]
          : [];
      });
  });
}
```

删除 `WAFFO_FEE`。`creditPrices()` 里的 `for (const pack of PACKS)` 改成 `VIDEO_PACKS`（从 plans 导入），让 `minCreditPrice` 只看视频包。

- [ ] **Step 5: 改 facts.ts**

把 `for (const pack of PACKS)` 改成 `VIDEO_PACKS`，`"video.seconds"` 不变，并加：

```ts
import { CHRISTMAS, STORIES, totalSeconds } from "./stories/index.ts";
// inside build():
  for (const story of Object.values(STORIES))
    out[`story.${story.id}.seconds`] = count(totalSeconds(story, story.kinds[0] ?? "human"));
  const xmas = PACKS.find((p) => p.story === "christmas");
  if (!xmas) throw new Error("the Christmas film has no product");
  out["story.christmas.usd"] = usd(xmas.usd);
  out["story.christmas.credits"] = count(CHRISTMAS.credits);
```

- [ ] **Step 6: 改调用方**

`apps/web/src/lib/pricing-view.ts`：`import { VIDEO_PACKS as PACKS, TIERS, usd } from "@vzc/catalog";`（只改这一行，其余逻辑不动）。

`scripts/stripe-setup.ts` 第 63–70 行附近，商品名改成：

```ts
  const videos = product.credits / TIERS.video.credits;
  const name =
    product.kind === "pack" && product.label
      ? `VideoZombieCouple — ${product.label}`
      : `VideoZombieCouple — ${videos} video${videos === 1 ? "" : "s"}`;
```

并把原来的 `name: \`VideoZombieCouple — …\`` 换成 `name,`。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm --filter @vzc/catalog test && pnpm typecheck && pnpm --filter @vzc/web test`
Expected: PASS。`node scripts/stripe-setup.ts test` 只打印计划、不改 Stripe：确认多出一行 `missing christmas1: VideoZombieCouple — 1 Christmas film (50 Christmases), $9.99`（读 `~/.vzc-secrets/stripe-test-secret.txt`；没有这个文件就跳过此确认，记在任务报告里）。

- [ ] **Step 8: Commit**

```bash
git add packages/catalog apps/web/src/lib/pricing-view.ts scripts/stripe-setup.ts
git commit -m "feat(pricing): cost and margin per story, Stripe fees, the \$9.99 Christmas film product

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 下单带故事：契约、D1 列、`StorySpec.story`、页面类型

**Files:**
- Create: `apps/api/migrations/0010_story_column.sql`
- Modify: `packages/contracts/src/stories.ts`
- Modify: `apps/api/src/stories/types.ts`
- Modify: `apps/api/src/routes/stories.ts`（`createStory` 与列表）
- Modify: `apps/web/src/components/account/AccountPanel.tsx`
- Test: `apps/api/test/stories-api.test.ts`

**Interfaces:**
- Consumes: `STORY_IDS`、`STORIES`、`StoryId`、`sceneLabel`。
- Produces:
  - `CreateStorySchema` 加 `story: z.enum(STORY_IDS).default("zombie")`，`scene: z.string().min(1).max(40)`
  - `StorySpec.story?: StoryId`，`StorySpec.scene: string`
  - `StoryView.story: StoryId`、`StoryView.scene: string`
  - D1 `stories.story TEXT NOT NULL DEFAULT 'zombie'`

- [ ] **Step 1: 写失败的测试**

在 `apps/api/test/stories-api.test.ts` 的 `describe("story API", …)` 里加（`signedIn`、`create` 是文件顶部已有的帮手，`storyBody(a, b, overrides)` 来自 harness）：

```ts
  it("records the story; a film without one is a zombie film", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    const res = await create(h, session);
    expect(res.status).toBe(201);
    const row = h.db.prepare("SELECT story FROM stories WHERE id=?").get(res.body.storyId as string);
    expect(row).toEqual({ story: "zombie" });
  });

  it("refuses a Christmas scene that is not live, a zombie scene in a Christmas film, and Christmas pets", async () => {
    const h = await setup({ FAKE_COMPOSER: "1" });
    const { session } = await signedIn(h);
    for (const extra of [
      { story: "christmas", scene: "snow-cabin", kind: "human" },
      { story: "christmas", scene: "cabin-wheat", kind: "human" },
      { story: "christmas", scene: "snow-cabin", kind: "pet" },
      { story: "zombie", scene: "snow-cabin", kind: "human" },
    ]) {
      const a = await h.upload();
      const b = await h.upload();
      const res = await create(h, session, storyBody(a, b, extra));
      expect(res.status, JSON.stringify(extra)).toBe(400);
      expect(res.body.error?.code).toBe("BAD_REQUEST");
    }
    expect(h.db.prepare("SELECT COUNT(*) AS n FROM stories").get()).toEqual({ n: 0 });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- stories-api`
Expected: FAIL（没有 `story` 列；christmas 请求被 zod 的 `scene` 枚举拒绝或被接受）。

- [ ] **Step 3: 迁移**

`apps/api/migrations/0010_story_column.sql`：

```sql
-- Christmas spec 2026-10-15 §4.2: which story a film tells. Every existing row is a zombie film.
ALTER TABLE stories ADD COLUMN story TEXT NOT NULL DEFAULT 'zombie';
```

- [ ] **Step 4: 契约与类型**

`packages/contracts/src/stories.ts`：

```ts
import { KINDS, type Kind, STORY_IDS, type StoryId } from "@vzc/catalog";
// …
export const CreateStorySchema = z.object({
  survivorKey: UploadKeySchema,
  infectedKey: UploadKeySchema,
  kind: z.enum(KINDS),
  /** Christmas spec §4.2: absent = the zombie story. Scene and kind are checked against it. */
  story: z.enum(STORY_IDS).default("zombie"),
  scene: z.string().min(1).max(40),
  names: Names.optional(),
  date: DateText.optional(),
  idempotencyKey: IdempotencyKey,
  consent: z.string().max(32).optional(),
});
```

`StoryView` 里 `scene: SceneId` 改为 `scene: string`，并加 `story: StoryId;`。删掉不再用的 `SCENE_IDS`/`SceneId` 导入。

`apps/api/src/stories/types.ts`：

```ts
import type { CapabilityId, Kind, StoryId } from "@vzc/catalog";
// …
export type StorySpec = {
  // …
  kind: Kind;
  /** Christmas spec §4.2; absent on films made before stories existed (zombie). */
  story?: StoryId;
  scene: string;
  // …
};
```

`StoryState.picks` 改为 `Partial<Record<string, string>>`（去掉 `FrameId` 导入）。

- [ ] **Step 5: 路由**

`apps/api/src/routes/stories.ts` 的 `createStory`，在 `const request = parsed.data` 之后、第 74 行的地区判断之前加：

```ts
  const story = STORIES[request.story];
  const scene = story.scenes[request.scene];
  if (!scene?.live || !story.kinds.includes(request.kind)) return fail(c, "BAD_REQUEST");
```

`spec` 里加 `story: request.story,`；INSERT 语句加 `story` 列与对应占位符、绑定 `request.story`。从 `@vzc/catalog` 导入 `STORIES`。

- [ ] **Step 6: 页面类型**

`apps/web/src/components/account/AccountPanel.tsx`：导入改为 `import { type Kind, sceneLabel, TIERS } from "@vzc/catalog";`，第 26 行 `scene: SceneId` 改 `scene: string`，第 45 行改为 `const scene = sceneLabel(story.scene);`。

`apps/api/src/durable-objects/story-runner.ts` 的 `#view` 的 `base` 里加 `story: snap.spec.story ?? "zombie",`（Task 6 会把这里整体改造，这一步只为通过类型检查）。

`apps/web/src/components/story/parts.tsx` 第 263 行的 `SCENES[props.scene]?.label ?? ""` 改为 `sceneLabel(props.scene)`（导入 `sceneLabel`），让渲染中的场记板以后也能显示圣诞场景名。`pnpm typecheck` 若还有别处用 `StoryView.scene` 去索引 `SCENES`，同样换成 `sceneLabel(...)`。

- [ ] **Step 7: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm typecheck`
Expected: PASS（harness 若用迁移目录建表，新列自动出现）。

- [ ] **Step 8: Commit**

```bash
git add apps/api/migrations/0010_story_column.sql packages/contracts apps/api/src apps/api/test apps/web/src/components/account/AccountPanel.tsx
git commit -m "feat(stories): a film records its story; scene and kind are checked against it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 按故事数据排生成步骤（graph）

**Files:**
- Modify: `apps/api/src/stories/graph.ts`
- Test: `apps/api/test/story-graph.test.ts`（新建）

**Interfaces:**
- Consumes: `Story`、`FrameRef`、`storyOf`、`ZOMBIE`、`CHRISTMAS`、`StorySpec.story`。
- Produces:
  - `videoSteps(story: Story, kind: Kind): StepRecord[]`（替换无参版本）
  - `scoreStepId(story: Story): string | null`（zombie → `"score:AC"`，christmas → `"score:widememory"`）
  - `frameKey(state: StoryState, frame: string): string | null`（挑中的候选或单张关键帧的输出 key）
  - `kieInputFor(step, state, url)` 签名不变，按 `refs` 解析
  - `readySteps` / `phaseOutcome` 不再写死 `A`/`C`

- [ ] **Step 1: 写失败的测试**

`apps/api/test/story-graph.test.ts`：

```ts
import { CHRISTMAS, ZOMBIE } from "@vzc/catalog";
import { describe, expect, it } from "vitest";
import { kieInputFor, phaseOutcome, readySteps, videoSteps } from "../src/stories/graph.ts";
import type { StoryState } from "../src/stories/types.ts";

const deps = (steps: ReturnType<typeof videoSteps>) =>
  Object.fromEntries(steps.map((s) => [s.id, s.deps]));

describe("graph: steps from the story's data", () => {
  it("builds exactly the zombie steps of before, for people and pets", () => {
    expect(deps(videoSteps(ZOMBIE, "human"))).toEqual({
      "kf:A:1": [],
      "kf:A:2": [],
      "kf:C:1": [],
      "kf:C:2": [],
      "score:AC": ["kf:A:1", "kf:A:2", "kf:C:1", "kf:C:2"],
      "kf:B": ["score:AC"],
      "shot:1": ["score:AC"],
      "shot:2": ["score:AC"],
      "shot:3": ["kf:B"],
      "shot:4": ["score:AC"],
      "shot:5": ["kf:B"],
      compose: ["shot:1", "shot:2", "shot:3", "shot:4", "shot:5"],
    });
    expect(deps(videoSteps(ZOMBIE, "pet"))["shot:3"]).toEqual(["kf:B"]);
  });

  it("builds the Christmas chain; clip shots make no step", () => {
    const d = deps(videoSteps(CHRISTMAS, "human"));
    expect(d["score:widememory"]).toEqual(["kf:wide:1", "kf:wide:2", "kf:memory:1", "kf:memory:2"]);
    expect(d["kf:forgetCold"]).toEqual(["score:widememory"]);
    expect(d["kf:forgetWarm"]).toEqual(["kf:forgetCold"]);
    expect(d["kf:embrace"]).toEqual(["kf:tree"]);
    expect(d["shot:6"]).toEqual(["kf:forgetWarm"]);
    expect(d["shot:4"]).toBeUndefined();
    expect(d["shot:9"]).toBeUndefined();
    expect(d.compose).toEqual(["shot:1", "shot:2", "shot:3", "shot:5", "shot:6", "shot:7", "shot:8"]);
  });
});

function stateOf(story: typeof CHRISTMAS, done: string[], failed: string[] = []): StoryState {
  const steps = Object.fromEntries(
    videoSteps(story, "human").map((s) => [
      s.id,
      {
        ...s,
        state: done.includes(s.id) ? "succeeded" : failed.includes(s.id) ? "failed" : "waiting",
        outputKey: done.includes(s.id) ? `kf/x/${s.id}.jpg` : null,
      },
    ]),
  ) as StoryState["steps"];
  return {
    spec: {
      id: "x",
      owner: "u:t",
      userId: "t",
      kind: "human",
      story: story.id,
      scene: "snow-cabin",
      names: null,
      date: null,
      survivorKey: "keep/x/survivor.jpg",
      infectedKey: "keep/x/infected.jpg",
      createdAt: 0,
    },
    status: "rendering",
    steps,
    picks: { wide: "kf/x/kf:wide:1.jpg", memory: "kf/x/kf:memory:2.jpg" },
    previewCharge: null,
    videoCharge: null,
    previewSettled: false,
    videoSettled: false,
    recomposeLeft: 1,
    output: null,
    errorCode: null,
    finishedAt: null,
    syncedSig: "",
  };
}

describe("graph: running a Christmas film", () => {
  it("scores once every candidate group has a winner, even if one candidate failed", () => {
    const s = stateOf(CHRISTMAS, ["kf:wide:1", "kf:memory:1", "kf:memory:2"], ["kf:wide:2"]);
    expect(readySteps(s).map((x) => x.id)).toContain("score:widememory");
  });

  it("fails when every candidate of one frame failed", () => {
    const s = stateOf(CHRISTMAS, ["kf:wide:1"], ["kf:memory:1", "kf:memory:2"]);
    expect(phaseOutcome(s, "video")).toBe("failed");
  });

  it("feeds each keyframe its refs in order: photo, picked frame, scene asset", async () => {
    const s = stateOf(CHRISTMAS, ["kf:wide:1", "kf:wide:2", "score:widememory"]);
    const url = async (key: string) => `signed:${key}`;
    const tree = await kieInputFor(s.steps["kf:tree"] as never, s, url);
    expect(tree.images).toEqual([
      "signed:keep/x/survivor.jpg",
      "signed:keep/x/infected.jpg",
      "signed:kf/x/kf:wide:1.jpg",
      "signed:assets/stories/christmas/snow-cabin/ornament.jpg",
    ]);
    expect(tree.prompt).toContain("raising the red glass heart ornament");
  });

  it("starts a shot on its keyframe with the story's length", async () => {
    const s = stateOf(CHRISTMAS, ["kf:forgetCold"]);
    const shot = await kieInputFor(s.steps["shot:1"] as never, s, async (k) => `signed:${k}`);
    expect(shot).toMatchObject({ first: "signed:kf/x/kf:forgetCold.jpg", targetSec: 3, images: [] });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- story-graph`
Expected: FAIL（`videoSteps` 不接参数、christmas 步骤不存在）。

- [ ] **Step 3: 实现 graph.ts**

用下面的代码替换 `graph.ts` 里 `videoSteps`、`candidates`、`readySteps`、`phaseOutcome`、`kieInputFor`（`step`、`previewSteps`、`photoSteps`、`isPhoto`、`activePhase`、`outputKeyFor`、`KieStepInput` 保留）：

```ts
import {
  type FrameRef,
  type Kind,
  portraitPrompt,
  type Story,
  type StoryKeyframe,
  storyOf,
} from "@vzc/catalog";

const scored = (story: Story) => story.keyframes.filter((k) => k.candidates >= 2);

/** The one scoring step of a film: zombie "score:AC" (kept for films already running). */
export function scoreStepId(story: Story): string | null {
  const ids = scored(story).map((k) => k.id);
  return ids.length ? `score:${ids.join("")}` : null;
}

function keyframe(story: Story, id: string): StoryKeyframe {
  const k = story.keyframes.find((x) => x.id === id);
  if (!k) throw new Error(`${story.id} has no keyframe ${id}`);
  return k;
}

/** The step that makes a frame usable: the scoring step for scored frames, else the frame's own. */
function frameStep(story: Story, id: string): string {
  return keyframe(story, id).candidates >= 2 ? (scoreStepId(story) as string) : `kf:${id}`;
}

/** Drops deps another dep already waits for (shot 3 waits for B, and B for the scoring). */
function reduce(ids: string[], all: Map<string, string[]>): string[] {
  const unique = [...new Set(ids)];
  const reaches = (from: string, to: string): boolean =>
    (all.get(from) ?? []).some((d) => d === to || reaches(d, to));
  return unique.filter((d) => !unique.some((o) => o !== d && reaches(o, d)));
}

/**
 * After payment (owner, 2026-10-15: nothing is generated for free): the candidates of the scored
 * keyframes, one scoring call, the other keyframes in the order their refs allow, every shot that
 * is not a scene clip, then compose.
 */
export function videoSteps(story: Story, kind: Kind): StepRecord[] {
  const graph = new Map<string, string[]>();
  const add = (s: StepRecord) => {
    s.deps = reduce(s.deps, graph);
    graph.set(s.id, s.deps);
    return s;
  };
  const refDeps = (refs: readonly FrameRef[]) =>
    refs.flatMap((r) => ("frame" in r ? [frameStep(story, r.frame)] : []));
  const candidates = scored(story).flatMap((k) =>
    Array.from({ length: k.candidates }, (_, i) =>
      add(step(`kf:${k.id}:${i + 1}`, "kie", "video", refDeps(k.refs), "keyframe")),
    ),
  );
  const scoreId = scoreStepId(story);
  const score = scoreId
    ? [add(step(scoreId, "score", "video", candidates.map((s) => s.id)))]
    : [];
  const singles = story.keyframes
    .filter((k) => k.candidates < 2)
    .map((k) => add(step(`kf:${k.id}`, "kie", "video", refDeps(k.refs), "keyframe")));
  const shots = story
    .storyboard(kind)
    .filter((s) => !("clip" in s.first))
    .map((s) =>
      add(
        step(
          `shot:${s.id}`,
          "kie",
          "video",
          [
            ...("frame" in s.first ? [frameStep(story, s.first.frame)] : []),
            ...(s.last ? [frameStep(story, s.last.frame)] : []),
          ],
          "shot",
        ),
      ),
    );
  const compose = add(step("compose", "compose", "video", shots.map((s) => s.id)));
  return [...candidates, ...score, ...singles, ...shots, compose];
}

const isCandidate = (id: string) => /^kf:[^:]+:\d+$/.test(id);
const frameOf = (id: string) => id.split(":")[1] as string;

/** Candidate steps of this film, by frame. */
function candidateGroups(state: StoryState): Map<string, StepRecord[]> {
  const groups = new Map<string, StepRecord[]>();
  for (const s of Object.values(state.steps))
    if (s.phase === "video" && isCandidate(s.id))
      groups.set(frameOf(s.id), [...(groups.get(frameOf(s.id)) ?? []), s]);
  return groups;
}

/** The R2 key a frame resolves to: the picked candidate, else the frame's own output. */
export function frameKey(state: StoryState, frame: string): string | null {
  return state.picks[frame] ?? state.steps[`kf:${frame}`]?.outputKey ?? null;
}
```

`readySteps` 的过滤体改成：

```ts
    const deps = s.deps.map((id) => state.steps[id]).filter((d): d is StepRecord => !!d);
    if (s.kind === "score" && s.phase === "video")
      return (
        deps.every(ended) &&
        [...candidateGroups(state).values()].every((g) => g.some((d) => d.state === "succeeded"))
      );
    return deps.every((d) => d.state === "succeeded");
```

`phaseOutcome` 的 video 部分改成：

```ts
  // A failed candidate is fine while another of the same frame can still win.
  for (const group of candidateGroups(state).values())
    if (group.every((s) => s.state === "failed")) return "failed";
  const steps = Object.values(state.steps).filter((s) => s.phase === "video" && !isCandidate(s.id));
  if (steps.some((s) => s.state === "failed")) return "failed";
  return state.steps.compose?.state === "succeeded" ? "succeeded" : "running";
```

`kieInputFor` 整体替换为：

```ts
/** The prompt and signed input URLs for one kie step (spec §4.2, §5; christmas spec §3). */
export async function kieInputFor(
  step: StepRecord,
  state: StoryState,
  url: (key: string) => Promise<string>,
): Promise<KieStepInput> {
  const { spec } = state;
  if (step.id === "kf:Z")
    return { prompt: portraitPrompt(), images: [await url(spec.survivorKey)] };
  const story = storyOf(spec);
  const scene = story.scenes[spec.scene];
  if (!scene) throw new Error(`${story.id} has no scene ${spec.scene}`);
  const need = (frame: string) => {
    const key = frameKey(state, frame);
    if (!key) throw new Error(`${step.id} needs keyframe ${frame}`);
    return url(key);
  };
  const resolve = (ref: FrameRef) => {
    if ("photo" in ref) return url(ref.photo === "survivor" ? spec.survivorKey : spec.infectedKey);
    if ("frame" in ref) return need(ref.frame);
    const key = scene.assets[ref.asset];
    if (!key) throw new Error(`scene ${scene.id} has no asset ${ref.asset}`);
    return url(`assets/${key}`);
  };
  if (step.id.startsWith("kf:")) {
    const k = keyframe(story, frameOf(step.id));
    return {
      prompt: k.prompt(spec.scene, spec.kind),
      images: await Promise.all(k.refs.map(resolve)),
    };
  }
  const shot = story.storyboard(spec.kind).find((s) => `shot:${s.id}` === step.id);
  if (!shot || "clip" in shot.first || !shot.prompt) throw new Error(`no kie input for step ${step.id}`);
  return {
    prompt: shot.prompt(spec.scene, spec.kind),
    images: [],
    first: await need(shot.first.frame),
    ...(shot.last ? { last: await need(shot.last.frame) } : {}),
    targetSec: shot.sec,
  };
}
```

删除旧的 `CANDIDATES_PER_FRAME`、`FrameId`、`keyframePrompt`、`STORYBOARD`、`shotPrompt`、`storyboard` 导入。

- [ ] **Step 4: 改唯一的调用方**

`apps/api/src/durable-objects/story-runner.ts` 的 `start()` 里：

```ts
          (spec.product === "photo"
            ? photoSteps()
            : [...previewSteps(), ...videoSteps(storyOf(spec), spec.kind)]
          ).map((s) => [s.id, s]),
```

从 `@vzc/catalog` 导入 `storyOf`。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm --filter @vzc/api typecheck`
Expected: `story-graph` 全部 PASS；现有 `story-runner`、`story-journey` 仍 PASS（丧尸步骤与依赖未变）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/stories/graph.ts apps/api/src/durable-objects/story-runner.ts apps/api/test/story-graph.test.ts
git commit -m "feat(stories): steps and kie inputs come from the story's keyframe refs; zombie steps unchanged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 运行器与扣费按故事走

**Files:**
- Modify: `apps/api/src/durable-objects/story-runner.ts`（`#score`、`#checkSources`、`#compose`、`#fakeSource`、结算、`#view`、`#eta` 里对 `storyboard`/`SCENES`/`TIERS`/`REQUIRED_FACES` 的引用）
- Modify: `apps/api/src/services/composer.ts`（`ScoreRequest`、`ComposeRequest` 类型）
- Modify: `apps/api/src/services/charge.ts`（`holdVideo` 加 `credits` 参数）
- Modify: `apps/api/src/routes/stories.ts`（`renderStory` 传故事积分）
- Modify: `apps/api/src/services/film-mail.ts`、`apps/api/src/ops/reminders.ts`（邮件按故事写片名与秒数）
- Modify: `apps/api/test/harness.ts`（`story()` 写入 `story` 列）
- Test: `apps/api/test/story-runner.test.ts`、`apps/api/test/stories-api.test.ts`、`apps/api/test/film-mail.test.ts`（新建）

**Interfaces:**
- Consumes: `storyOf`、`Story.title/overlays/holdSec/titleAt/scenes`、`frameKey`、`scoreStepId`（Task 5）。
- Produces:
  - `ScoreRequest.candidates[].frame: string`，`ScoreRequest.requiredFaces: Record<string, Face[]>`
  - `ComposeRequest`：`shots[]` 加 `flash: boolean`；`caption` 加 `line3: string | null`；新增 `holdSec: number`、`titleAt: number | null`、`overlays: { text: string; start: number; end: number }[]`
  - `holdVideo(c, storyId, reservationId = storyId, credits = TIERS.video.credits)`
  - `StoryView.frames` 按故事关键帧顺序（zombie 仍是 A、C、B）
  - `filmMail(env, { …, story: StoryId })`：片名 zombie「zombie love story」、christmas「50 Christmases film」，秒数取 `totalSeconds`

- [ ] **Step 1: 写失败的测试**

`apps/api/test/story-runner.test.ts` 末尾加：

```ts
describe("StoryRunner: stories", () => {
  async function christmas(h: Awaited<ReturnType<typeof setup>>) {
    const { spec, runner } = await h.story({ story: "christmas", scene: "snow-cabin" });
    for (const name of ["ornament.jpg", "hands.mp4", "window.mp4", "music.m4a"])
      await h.r2.BUCKET.put(`assets/stories/christmas/snow-cabin/${name}`, new Uint8Array([1]));
    await runner.start(spec);
    await untilStatus(h, runner, "preview_ready");
    return { spec, runner };
  }

  it("renders a Christmas film: nine keyframes, seven shots, clips from the scene, 20 credits", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await christmas(h);
    expect(await runner.render(await creditHold(h, spec.id, 20, 20))).toEqual({ ok: true });
    const view = await untilStatus(h, runner, "done");
    expect(view.story).toBe("christmas");
    const req = calls.composeRequests[0];
    expect(req?.shots.map((s) => s.grade)).toEqual([
      "cold", "cold", "cold", "cold", "cold", "amber", "golden", "amber-dawn", "amber-dawn",
    ]);
    expect(req?.shots[3]?.url).toContain("assets/stories/christmas/snow-cabin/hands.mp4");
    expect(req?.shots[8]?.url).toContain("assets/stories/christmas/snow-cabin/window.mp4");
    expect(req?.shots.map((s) => s.flash)).toEqual([false, false, false, false, false, false, true, false, false]);
    expect(req?.holdSec).toBe(0);
    expect(req?.titleAt).toBe(30);
    expect(req?.overlays.map((o) => o.start)).toEqual([0, 10]);
    expect(req?.caption.line1).toMatch(/^Our first Christmas · \d{4}$/);
    expect(req?.musicUrl).toContain("assets/stories/christmas/snow-cabin/music.m4a");
    const kie = stepAttempts(h, spec.id).filter((s) => s.attempts.length > 0).map((s) => s.id);
    expect(kie.filter((id) => id.startsWith("kf:"))).toHaveLength(9);
    expect(kie.filter((id) => id.startsWith("shot:"))).toHaveLength(7);
    expect(h.wallet.calls.some((c) => c[0] === "commit" && c[2] === spec.id && c[3] === 20)).toBe(true);
  });

  it("a failed Christmas film gives all 20 credits back", async () => {
    const h = await setup({
      FAKE_SCRIPT: JSON.stringify(
        Object.fromEntries(
          ROUTES.filter((r) => r.capability === "shot").map((r) => [
            r.model,
            Array(40).fill({ kind: "fail", failMsg: "content policy violation" }),
          ]),
        ),
      ),
    });
    scripted(h);
    const { spec, runner } = await christmas(h);
    await runner.render(await creditHold(h, spec.id, 20, 20));
    await untilStatus(h, runner, "failed");
    expect(h.wallet.calls).toContainEqual(["release", "test", spec.id, spec.id]);
    expect(h.wallet.calls.some((c) => c[0] === "commit")).toBe(false);
  });

  it("a zombie film already running when stories shipped (no story field) still finishes", async () => {
    const h = await setup();
    const calls = scripted(h);
    const { spec, runner } = await readyStory(h);
    expect(spec.story).toBeUndefined();
    await runner.render(await creditHold(h, spec.id));
    const view = await untilStatus(h, runner, "done");
    expect(view.story).toBe("zombie");
    expect(calls.composeRequests[0]?.caption.line1).toBe("Even at the end of the world.");
    expect(calls.composeRequests[0]?.holdSec).toBe(1);
    expect(calls.composeRequests[0]?.titleAt).toBeNull();
    expect(calls.composeRequests[0]?.overlays).toEqual([]);
    expect(h.wallet.calls.some((c) => c[0] === "commit" && c[2] === spec.id && c[3] === 10)).toBe(true);
  });
});
```

`creditHold` 改成接受预扣积分（第 4 个参数）：

```ts
async function creditHold(
  h: Awaited<ReturnType<typeof setup>>,
  storyId: string,
  credits = 10,
  reserve = TIERS.video.credits,
): Promise<ChargeHold> {
  // … grant `credits` as before …
  const reserved = await wallet.reserve("test", storyId, reserve, storyId);
  expect(reserved.ok).toBe(true);
  return { kind: "credits", userId: "test", reservationId: storyId, reserved: reserve };
}
```

（harness 的假钱包把 commit 记成 `["commit", userId, reservationId, credits, jobId]`，release 记成 `["release", userId, reservationId, jobId]`。）

`apps/api/test/stories-api.test.ts` 的 `describe("story API", …)` 里加（导入 `CHRISTMAS` 自 `@vzc/catalog`；测试里临时把场景设为上线，结束时还原）：

```ts
  it("a Christmas render with credits for one zombie video is refused and charges nothing", async () => {
    const scene = CHRISTMAS.scenes["snow-cabin"] as { live: boolean };
    scene.live = true;
    try {
      const h = await setup({ FAKE_COMPOSER: "1" });
      const { userId, session } = await signedIn(h);
      await h.wallets.instance(userId).grant(userId, {
        kind: "pack",
        credits: 10,
        expiresAt: null,
        sourceRef: "order-one-zombie-video",
        reason: "test",
      });
      const a = await h.upload();
      const b = await h.upload();
      const made = await create(h, session, storyBody(a, b, { story: "christmas", scene: "snow-cabin" }));
      expect(made.status).toBe(201);
      const id = made.body.storyId as string;
      await h.untilStory(id, "preview_ready");
      const res = await h.call(`/v1/stories/${id}/render`, {
        method: "POST",
        session,
        body: { idempotencyKey: "render-xmas-1" },
      });
      expect(res.body.error?.code).toBe("CREDITS_LOW");
      expect((await h.wallets.instance(userId).balance(userId)).total).toBe(10);
      expect((await h.call(`/v1/stories/${id}`, { session })).body.status).toBe("preview_ready");
    } finally {
      scene.live = false;
    }
  });
```

`apps/api/test/film-mail.test.ts`（新建）：

```ts
import { describe, expect, it } from "vitest";
import { filmMail } from "../src/services/film-mail.ts";

const env = { ALLOWED_ORIGIN: "https://videozombiecouple.com" } as never;
const base = { storyId: "s1", email: "a@example.com", verified: true, expiresAt: Date.UTC(2026, 11, 30), reminder: false };

describe("film emails name the story", () => {
  it("zombie films keep their words and 15 seconds", async () => {
    const mail = await filmMail(env, { ...base, story: "zombie" });
    expect(mail.subject).toBe("Your zombie love story is ready");
    expect(mail.intro).toContain("Your 15-second film is ready");
  });

  it("a Christmas film is a 50 Christmases film of 32 seconds, also in the reminder", async () => {
    const ready = await filmMail(env, { ...base, story: "christmas" });
    expect(ready.subject).toBe("Your 50 Christmases film is ready");
    expect(ready.intro).toContain("Your 32-second film is ready");
    const reminder = await filmMail(env, { ...base, story: "christmas", reminder: true });
    expect(reminder.subject).toBe("Your 50 Christmases film is deleted tomorrow");
  });
});
```

`apps/api/test/harness.ts` 的 `story()`：INSERT 语句加 `story` 列，值为 `spec.story ?? "zombie"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vzc/api test -- story-runner stories-api`
Expected: FAIL（christmas 合成请求没有新字段、扣的是 10 积分、`view.story` 不存在等）。

- [ ] **Step 3: composer 客户端类型**

`apps/api/src/services/composer.ts`：

```ts
import type { Face, Grade } from "@vzc/catalog";

export type ScoreRequest = {
  sources: { survivor: string; infected: string | null };
  candidates: { id: string; url: string; frame: string }[];
  requiredFaces: Record<string, Face[]>;
  checkAge: boolean;
};

export type ComposeRequest = {
  /** anchor "end": the clip ends on a keyframe, so keep its last `seconds`. flash: white frames at the cut in. */
  shots: { url: string; seconds: number; grade: Grade; anchor: "start" | "end"; flash: boolean }[];
  musicUrl: string;
  caption: { line1: string; line2: string | null; line3: string | null };
  /** Seconds the last frame is held under the title (zombie 1, christmas 0). */
  holdSec: number;
  /** When the title starts fading in; null = just before the end (the composer's default). */
  titleAt: number | null;
  overlays: { text: string; start: number; end: number }[];
  outUrl: string;
  posterUrl: string;
  keys: { shots: string[]; out: string; poster: string };
};
```

`fakeComposer.score` 里 `new Set<FrameId>()` 改为 `new Set<string>()`。

- [ ] **Step 4: 扣费**

`apps/api/src/services/charge.ts`：

```ts
export async function holdVideo(
  c: Context<AppEnv>,
  storyId: string,
  reservationId: string = storyId,
  credits: number = TIERS.video.credits,
): Promise<Hold> {
  // … same body, without the `const credits = TIERS.video.credits;` line …
}
```

`apps/api/src/routes/stories.ts` 的 `renderStory`：

```ts
  const hold = await holdVideo(c, id, reservationId, storyOf({ story: current.story }).credits);
```

（`current` 是 `runnerFor(c, id).view()` 的结果，Task 4 已给 `StoryView` 加 `story`。）

- [ ] **Step 5: 运行器**

`apps/api/src/durable-objects/story-runner.ts`：

1. 导入：去掉 `REQUIRED_FACES`、`SCENES`、`storyboard`、`TIERS`，加 `storyOf`；从 `../stories/graph.ts` 加 `frameKey`；删掉文件内的 `const CAPTION_LINE1 = …`。
2. `#fakeSource`：

```ts
  #fakeSource(state: StoryState, step: StepRecord): string {
    if (step.capability !== "shot") return state.spec.survivorKey;
    const shot = storyOf(state.spec).storyboard(state.spec.kind).find((s) => `shot:${s.id}` === step.id);
    if (!shot || "clip" in shot.first) return state.spec.survivorKey;
    return frameKey(state, shot.first.frame) ?? state.spec.survivorKey;
  }
```

3. `#checkSources`：`requiredFaces: { A: [], B: [], C: [] }` 改为 `requiredFaces: {}`。
4. `#score`：

```ts
    const story = storyOf(spec);
    const candidates = await Promise.all(
      succeeded.map(async (s) => ({
        id: s.id,
        url: await this.#url(s.outputKey as string),
        frame: s.id.split(":")[1] as string,
      })),
    );
    const pet = spec.kind === "pet";
    const result = await this.#composer().score({
      sources: { /* unchanged */ },
      candidates,
      requiredFaces: Object.fromEntries(
        story.keyframes.map((k) => [k.id, [...(pet ? k.petFaces : k.faces)]]),
      ),
      checkAge: true,
    });
    // … face / age checks unchanged …
    for (const frame of new Set(candidates.map((c) => c.frame))) {
      const options = candidates.filter((c) => c.frame === frame);
      // … same best-of reduce …
      if (chosen) state.picks[frame] = chosen;
    }
```

5. `#compose`：

```ts
  async #compose(state: StoryState, step: StepRecord): Promise<void> {
    const { spec } = state;
    const story = storyOf(spec);
    const scene = story.scenes[spec.scene];
    if (!scene) throw new Error(`${story.id} has no scene ${spec.scene}`);
    const shots = story.storyboard(spec.kind).map((shot) => {
      const key =
        "clip" in shot.first
          ? scene.assets[shot.first.clip] && `assets/${scene.assets[shot.first.clip]}`
          : state.steps[`shot:${shot.id}`]?.outputKey;
      if (!key) throw new Error(`shot ${shot.id} has no output`);
      return {
        key,
        seconds: shot.sec,
        grade: shot.grade,
        anchor: shot.last ? "end" : "start",
        flash: shot.flash ?? false,
      } as const;
    });
    const outKey = `out/${spec.id}/video.mp4`;
    const posterKey = `out/${spec.id}/poster.jpg`;
    const title = story.title(spec);
    await this.#composer().compose({
      shots: await Promise.all(
        shots.map(async (s) => ({
          url: await this.#url(s.key),
          seconds: s.seconds,
          grade: s.grade,
          anchor: s.anchor,
          flash: s.flash,
        })),
      ),
      musicUrl: await this.#url(`assets/${scene.musicKey}`),
      caption: title,
      holdSec: story.holdSec,
      titleAt: story.titleAt,
      overlays: [...story.overlays],
      outUrl: await presign(this.env, outKey, "PUT", INPUT_URL_SEC),
      posterUrl: await presign(this.env, posterKey, "PUT", INPUT_URL_SEC),
      keys: { shots: shots.map((s) => s.key), out: outKey, poster: posterKey },
    });
    step.state = "succeeded";
    step.outputKey = outKey;
    step.nextRunAt = null;
    state.output = { videoKey: outKey, posterKey };
  }
```

6. 结算：`ok ? TIERS.video.credits : null` 改为 `ok ? storyOf(state.spec).credits : null`。
7. `#view`：`base` 里 `story: storyOf(snap.spec).id,`；`frames` 改为

```ts
      frames:
        snap.status === "rendering"
          ? await Promise.all(
              storyOf(snap.spec)
                .keyframes.map((k) =>
                  snap.picks[k.id] ??
                  (snap.steps[`kf:${k.id}`]?.state === "succeeded" ? snap.steps[`kf:${k.id}`]?.outputKey : null),
                )
                .filter((key): key is string => !!key)
                .map(sign),
            )
          : [],
```

8. 用 `grep -n "storyboard\|SCENES\|TIERS\|CAPTION_SEC\|REQUIRED_FACES" apps/api/src/durable-objects/story-runner.ts` 找剩下的引用（如 `#eta`），一律换成 `storyOf(state.spec)` 上的对应数据（`storyboard(kind)`、`scenes`、`credits`、`holdSec`）。
9. 邮件：`apps/api/src/services/film-mail.ts`

```ts
import { RETENTION, type StoryId, STORIES, totalSeconds } from "@vzc/catalog";

const FILM_NAME: Record<StoryId, string> = {
  zombie: "zombie love story",
  christmas: "50 Christmases film",
};

export async function filmMail(
  env: Bindings,
  o: {
    storyId: string;
    email: string;
    verified: boolean;
    expiresAt: number;
    reminder: boolean;
    story: StoryId;
  },
): Promise<{ to: string; subject: string; intro: string; link: { href: string; label: string } }> {
  const told = STORIES[o.story];
  const seconds = totalSeconds(told, told.kinds[0] ?? "human");
  const name = FILM_NAME[o.story];
  // … the rest unchanged, with the two subjects written as:
  //   subject: `Your ${name} is deleted tomorrow`
  //   subject: `Your ${name} is ready`
}
```

   调用方：运行器第 890 行附近传 `story: storyOf(state.spec).id`；`apps/api/src/ops/reminders.ts` 的 SELECT 加 `s.story`，行类型加 `story: StoryId`，调用时传 `story: row.story`。
10. `recompose`（改名字 / 日期只重跑合成）不用改：它重跑 `#compose`，`title` 从故事数据重新算。

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm --filter @vzc/api test && pnpm typecheck && pnpm lint`
Expected: 全部 PASS，包括原有丧尸用例。

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/contracts
git commit -m "feat(stories): the runner scores, composes and charges by story; old zombie films finish as before

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: composer：新调色、中途叠字、白闪、末帧停留与字幕卡时间

**Files:**
- Modify: `apps/composer/grade.py`
- Modify: `apps/composer/caption.py`
- Modify: `apps/composer/app.py`
- Test: `apps/composer/tests/test_grade.py`、`apps/composer/tests/test_app.py`

**Interfaces:**
- Consumes: Task 6 的 `ComposeRequest` JSON（`shots[].flash`、`caption.line3`、`holdSec`、`titleAt`、`overlays`）。
- Produces:
  - `GRADES` 加 `amber`、`golden`、`amber-dawn`
  - `Part(path, seconds, grade, anchor="start", flash=False)`
  - `build_compose_cmd(parts, music, caption_png, out, mark_png=None, hold_sec=CAPTION_SEC, title_at=None, overlays=None)`，`overlays` 是 `[(png_path, start, end), …]`
  - `total_seconds(parts, hold_sec=CAPTION_SEC)`
  - `render_caption(line1, line2, out, line3=None)`、`render_overlay(text, out) -> str`
  - 请求字段全部可选，缺省 = 现状（丧尸片的合成命令逐字不变）

- [ ] **Step 1: 写失败的测试**

`apps/composer/tests/test_grade.py` 末尾加：

```python
XMAS = [
    Part("s1.mp4", 3, "cold"),
    Part("s2.mp4", 3, "cold"),
    Part("s3.mp4", 4, "cold"),
    Part("s4.mp4", 3, "cold"),
    Part("s5.mp4", 4, "cold"),
    Part("s6.mp4", 3, "amber"),
    Part("s7.mp4", 4, "golden", flash=True),
    Part("s8.mp4", 4, "amber-dawn"),
    Part("s9.mp4", 4, "amber-dawn"),
]


def test_the_zombie_command_is_unchanged_by_the_new_options():
    old = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4", mark_png="mark.png")
    new = build_compose_cmd(PARTS, "m.m4a", "cap.png", "out.mp4", mark_png="mark.png", hold_sec=1, title_at=None, overlays=[])
    assert old == new


def test_a_christmas_film_is_32_seconds_with_no_held_frame_and_the_title_at_30():
    joined = " ".join(build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30))
    assert total_seconds(XMAS, hold_sec=0) == 32
    assert "tpad" not in joined
    assert "fade=t=in:st=30:d=0.8:alpha=1" in joined
    assert "afade=t=out:st=30:d=2" in joined
    assert joined.endswith("-t 32 out.mp4")


def test_the_new_grades_are_applied():
    joined = " ".join(build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30))
    from grade import GRADES

    for g in ("amber", "golden", "amber-dawn"):
        assert GRADES[g] in joined


def test_the_memory_cut_flashes_white_for_four_frames():
    cmd = build_compose_cmd(XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30)
    graph = cmd[cmd.index("-filter_complex") + 1]
    v6 = next(c for c in graph.split(";") if c.startswith("[6:v]"))
    assert "fade=t=in:st=0:d=0.17:color=white" in v6
    assert graph.count("color=white") == 1


def test_overlays_show_only_in_their_time_window():
    cmd = build_compose_cmd(
        XMAS, "m.m4a", "cap.png", "out.mp4", hold_sec=0, title_at=30,
        overlays=[("o1.png", 0, 5), ("o2.png", 10, 13)],
    )
    joined = " ".join(cmd)
    assert "-loop 1 -t 32 -i o1.png" in joined and "-loop 1 -t 32 -i o2.png" in joined
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=4.6:d=0.4:alpha=1" in graph
    assert "enable='between(t,10,13)'" in graph


def test_the_poster_of_a_christmas_film_is_the_golden_memory():
    cmd = build_poster_cmd("out.mp4", XMAS, "poster.jpg")
    # 3+3+4+3+4+3 seconds before the memory, then one second in.
    assert cmd[cmd.index("-ss") + 1] == "21"
```

`apps/composer/tests/test_app.py` 末尾加（沿用文件里的 `files`、`clip`、`tone`、`probe` 帮手）：

```python
def test_compose_makes_a_32_second_christmas_film_with_overlays(files):
    tmp, uploads = files
    secs = [3, 3, 4, 3, 4, 3, 4, 4, 4]
    grades = ["cold"] * 5 + ["amber", "golden", "amber-dawn", "amber-dawn"]
    shots = [
        {"url": clip(tmp / f"s{i}.mp4", 5, "gray"), "seconds": s, "grade": g, "flash": i == 6}
        for i, (s, g) in enumerate(zip(secs, grades))
    ]
    body = {
        "shots": shots,
        "musicUrl": tone(tmp / "m.m4a", 40),
        "caption": {"line1": "Our first Christmas · 2026", "line2": "and every one after.", "line3": "Tom & Amy"},
        "holdSec": 0,
        "titleAt": 30,
        "overlays": [
            {"text": "Our 50th Christmas. Today, you asked me my name.", "start": 0, "end": 5},
            {"text": "So I brought back our first one.", "start": 10, "end": 13},
        ],
        "outUrl": "video.mp4",
        "posterUrl": "poster.jpg",
    }
    r = TestClient(composer.app).post("/compose", json=body)
    assert r.status_code == 200, r.text
    info = probe(uploads / "video.mp4")
    assert (info["width"], info["height"]) == (720, 1280)
    assert abs(info["duration"] - 32) < 0.2


def test_compose_refuses_an_unknown_grade(files):
    tmp, _ = files
    body = {
        "shots": [{"url": clip(tmp / "a.mp4", 4, "navy"), "seconds": 3, "grade": "sepia"}],
        "musicUrl": tone(tmp / "m.m4a", 5),
        "caption": {"line1": "x"},
        "outUrl": "video.mp4",
        "posterUrl": "poster.jpg",
    }
    assert TestClient(composer.app).post("/compose", json=body).status_code == 400


def test_a_long_overlay_wraps_inside_the_frame(tmp_path):
    from PIL import Image

    from caption import render_overlay

    out = render_overlay("Our 50th Christmas. Today, you asked me my name.", str(tmp_path / "o.png"))
    img = Image.open(out)
    assert img.size == (720, 1280)
    # Text sits in the upper third; the lower two thirds stay transparent.
    assert img.getchannel("A").crop((0, 900, 720, 1280)).getextrema() == (0, 0)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/composer && uv run pytest -q`
Expected: FAIL（`Part` 没有 `flash`、`build_compose_cmd` 不接 `hold_sec` 等）。

- [ ] **Step 3: 实现 grade.py**

`GRADES` 加三项：

```python
    # Christmas: amber lamplight; the golden memory, a little overexposed; amber with dawn at the window.
    "amber": "eq=saturation=1.02:contrast=1.03,colorbalance=rs=0.10:rm=0.05:bs=-0.08:bm=-0.03",
    "golden": "eq=saturation=1.10:brightness=0.04,colorbalance=rs=0.10:rm=0.06:rh=0.06:bs=-0.08",
    "amber-dawn": "eq=saturation=1.0,colorbalance=rs=0.07:rm=0.04:rh=0.10:bs=0.02:bh=-0.04",
```

`Part` 加 `flash: bool = False`。常量加 `FLASH_SEC = 0.17`（24fps 的 4 帧）、`OVERLAY_FADE_SEC = 0.4`。

`total_seconds` 与 `build_compose_cmd` 替换为：

```python
def total_seconds(parts: list[Part], hold_sec: float = CAPTION_SEC) -> float:
    return sum(p.seconds for p in parts) + hold_sec


def build_compose_cmd(
    parts: list[Part],
    music: str,
    caption_png: str,
    out: str,
    mark_png: str | None = None,
    hold_sec: float = CAPTION_SEC,
    title_at: float | None = None,
    overlays: list[tuple[str, float, float]] | None = None,
) -> list[str]:
    total = total_seconds(parts, hold_sec)
    overlays = overlays or []
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in parts:
        if p.anchor == "end":
            cmd += ["-sseof", f"-{fmt(p.seconds)}"]
        cmd += ["-t", fmt(p.seconds), "-i", p.path]
    cap = len(parts)
    cmd += ["-loop", "1", "-i", caption_png]
    cmd += ["-i", music]
    mark_at = None
    if mark_png:
        mark_at = cap + 2
        cmd += ["-i", mark_png]
    first_overlay = cap + (3 if mark_png else 2)
    for png, _, _ in overlays:
        cmd += ["-loop", "1", "-t", fmt(total), "-i", png]
    frame = f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},fps={FPS},setsar=1"
    chains = []
    for i, p in enumerate(parts):
        flash = f",fade=t=in:st=0:d={fmt(FLASH_SEC)}:color=white" if p.flash else ""
        chains.append(f"[{i}:v]{frame},{GRADES[p.grade]}{flash},format=yuv420p[v{i}]")
    labels = "".join(f"[v{i}]" for i in range(len(parts)))
    hold = f",tpad=stop_mode=clone:stop_duration={fmt(hold_sec)}" if hold_sec > 0 else ""
    chains.append(f"{labels}concat=n={len(parts)}:v=1:a=0{hold}[cat]")
    at = title_at if title_at is not None else total - TITLE_LEAD_SEC - TITLE_FADE_SEC
    chains.append(
        f"[{cap}:v]format=rgba,fade=t=in:st={fmt(round(at, 3))}:d={fmt(TITLE_FADE_SEC)}:alpha=1[title]"
    )
    current = "cat"
    for j, (_, start, end) in enumerate(overlays):
        fade_out = round(end - OVERLAY_FADE_SEC, 3)
        chains.append(
            f"[{first_overlay + j}:v]format=rgba,"
            f"fade=t=in:st={fmt(start)}:d={fmt(OVERLAY_FADE_SEC)}:alpha=1,"
            f"fade=t=out:st={fmt(fade_out)}:d={fmt(OVERLAY_FADE_SEC)}:alpha=1[ov{j}]"
        )
        chains.append(f"[{current}][ov{j}]overlay=0:0:enable='between(t,{fmt(start)},{fmt(end)})'[o{j}]")
        current = f"o{j}"
    chains.append(f"[{current}][title]overlay=0:0:shortest=1,format=yuv420p[titled]")
    if mark_at is not None:
        chains.append("[titled]noise=alls=6:allf=t[grain]")
        chains.append(f"[grain][{mark_at}:v]overlay=W-w-24:H-h-28[vout]")
    else:
        chains.append("[titled]noise=alls=6:allf=t[vout]")
    chains.append(
        f"[{cap + 1}:a]atrim=0:{fmt(total)},asetpts=PTS-STARTPTS,"
        f"afade=t=out:st={fmt(total - FADE_OUT_SEC)}:d={fmt(FADE_OUT_SEC)}[aout]"
    )
    cmd += ["-filter_complex", ";".join(chains), "-map", "[vout]", "-map", "[aout]"]
    cmd += ["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    # EU AI Act art. 50: the film says, in its own metadata, that it is AI-generated.
    cmd += ["-metadata", "comment=AI-generated video, made with VideoZombieCouple"]
    cmd += ["-metadata", "ai_generated=true"]
    cmd += ["-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart+use_metadata_tags", "-t", fmt(total), out]
    return cmd
```

（无叠字、`hold_sec=1`、`title_at=None` 时，生成的命令与原来逐字相同——`test_the_zombie_command_is_unchanged_by_the_new_options` 与原有测试守护这一点。）

`build_poster_cmd` 的第一行改为：

```python
    warm = next((i for i, p in enumerate(parts) if p.grade in ("warm", "golden")), len(parts) - 1)
```

- [ ] **Step 4: 实现 caption.py**

`render_caption` 加 `line3: str | None = None` 参数（放在 `out` 之后，保持旧调用兼容），在 `line2` 下方再画一行：

```python
    if line3:
        f3 = _fit(draw, line3, serif, 34, WIDTH - 140)
        draw.text((WIDTH / 2, y + 140), line3, font=f3, fill=DIM, anchor="mm")
```

新增：

```python
def render_overlay(text: str, out: str) -> str:
    """A line of the film's own words (christmas spec §2.2): serif, upper third, on a soft dark band."""
    img = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    serif = FONTS / "CormorantGaramond-Italic.ttf"
    font = ImageFont.truetype(str(serif), 46)
    words, lines, line = text.split(), [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=font) <= WIDTH - 120:
            line = trial
        else:
            lines.append(line)
            line = w
    lines.append(line)
    top = HEIGHT // 6
    band_h = 60 * len(lines) + 60
    for i in range(band_h):
        a = int(150 * (1 - abs(i - band_h / 2) / (band_h / 2)))
        draw.line([(0, top - 30 + i), (WIDTH, top - 30 + i)], fill=(*VEIL, a))
    for n, ln in enumerate(lines):
        draw.text((WIDTH / 2, top + 30 + n * 60), ln, font=font, fill=WARM, anchor="mm")
    img.save(out, "PNG")
    return out
```

- [ ] **Step 5: 实现 app.py**

```python
from caption import render_caption, render_mark, render_overlay
from grade import CAPTION_SEC, GRADES, Part, build_compose_cmd, build_poster_cmd


class Shot(BaseModel):
    url: str
    seconds: float
    grade: str
    anchor: str = "start"
    flash: bool = False


class Caption(BaseModel):
    line1: str
    line2: str | None = None
    line3: str | None = None


class Overlay(BaseModel):
    text: str
    start: float
    end: float


class ComposeBody(BaseModel):
    shots: list[Shot]
    musicUrl: str
    caption: Caption
    outUrl: str
    posterUrl: str
    holdSec: float = CAPTION_SEC
    titleAt: float | None = None
    overlays: list[Overlay] = []
```

`_compose` 里：

```python
    if not body.shots or any(s.grade not in GRADES or s.anchor not in ("start", "end") for s in body.shots):
        raise HTTPException(400, "bad shots")
    # …
            parts.append(Part(str(p), s.seconds, s.grade, s.anchor, s.flash))
        # …
        cap = render_caption(body.caption.line1, body.caption.line2, str(d / "caption.png"), body.caption.line3)
        overlays = [
            (render_overlay(o.text, str(d / f"overlay{j}.png")), o.start, o.end)
            for j, o in enumerate(body.overlays)
        ]
        # …
        subprocess.run(
            build_compose_cmd(
                parts, str(music), cap, str(out), mark_png=mark,
                hold_sec=body.holdSec, title_at=body.titleAt, overlays=overlays,
            ),
            check=True,
        )
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd apps/composer && uv run pytest -q && docker build -t vzc-composer apps/composer`
Expected: 全部 PASS；镜像能构建（没装 Docker 就跳过镜像这一步并在报告里说明）。

- [ ] **Step 7: Commit**

```bash
git add apps/composer
git commit -m "feat(composer): amber, golden and dawn grades, timed overlays, a white flash cut, configurable hold and title time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 部署上传故事素材、素材清单、经验记录

**Files:**
- Modify: `scripts/deploy.sh`
- Create: `assets/stories/README.md`
- Modify: `docs/lessons.md`

**Interfaces:**
- Consumes: Task 2 的素材 key：`stories/christmas/<scene>/{ornament.jpg,hands.mp4,window.mp4,music.m4a}`。
- Produces: 部署时 `assets/stories/**` 上传到 R2 `assets/stories/**`（文件由第二份计划生成）。

- [ ] **Step 1: deploy.sh**

在 `scripts/deploy.sh` 第 47–50 行（场景音乐上传循环）之后加：

```bash
echo "== story assets → r2://$bucket/assets/stories/"
if [ -d "$root/assets/stories" ]; then
  find "$root/assets/stories" -type f ! -name '*.md' | while read -r f; do
    rel="${f#"$root/assets/"}"
    case "$f" in
      *.jpg) type=image/jpeg ;;
      *.mp4) type=video/mp4 ;;
      *.m4a) type=audio/mp4 ;;
      *) echo "skip $rel (unknown type)"; continue ;;
    esac
    api r2 object put "$bucket/assets/$rel" --file "$f" --content-type "$type" --remote >/dev/null
  done
fi
```

Run: `bash -n scripts/deploy.sh`
Expected: 无输出（语法正确）。

- [ ] **Step 2: 素材清单**

`assets/stories/README.md`：

```markdown
# Story assets

Made once per scene and uploaded to R2 `assets/stories/…` on deploy (`scripts/deploy.sh`). Every
order reuses them: they cost nothing per film and never fail.

## christmas/<scene>/ (christmas spec §3.2)

| File | What | How |
|---|---|---|
| `ornament.jpg` | The red glass heart ornament with a gold ribbon, plain background | 即梦 (Seedream), one image per scene |
| `hands.mp4` | Shot 4: old hands open a faded red box, the thumb brushes the ornament, lifts it out of frame (≥ 3 s) | keyframe in 即梦 → image-to-video, 3–5 s |
| `window.mp4` | Shot 9: from outside, the lit tree through the window, snow, dawn coming (≥ 4 s) | keyframe in 即梦 → image-to-video, 4–5 s |
| `music.m4a` | 32 s: music and sound effects on the storyboard's timeline (clock, wind, floor, box, chimes, laughter; silence at 0:10–0:13; drum hit at 0:20) | suno.com during the Suno Pro subscription, mixed to the timeline; licence noted below |

Scenes: `snow-cabin`, `city-flat`, `farmhouse`. A scene goes `live: true` in
`packages/catalog/src/stories/christmas.ts` only after its four files are here and its prompts
passed the eval.
```

- [ ] **Step 3: lessons**

在 `docs/lessons.md` 的「四、模型和素材」下加一条：

```markdown
- **加新故事不改生成流程。**
  - 现象：丧尸片的 A/B/C 关键帧和 5 个镜头写死在 `graph.ts`、运行器和合成里，第二个故事塞不进去。
  - 做法：故事是 `packages/catalog/src/stories/` 里的一份数据（关键帧引用、分镜、叠字、字幕卡、积分）。生成步骤和依赖由关键帧引用自动排出；场景共用的成片用 `{ clip }`，不发起模型调用。
  - 守护：`packages/catalog/test/stories.test.ts`（丧尸包装与原数据逐项相等、`validateStory`）、`apps/api/test/story-graph.test.ts`（丧尸步骤与依赖不变）。
```

- [ ] **Step 4: 全量检查**

Run: `pnpm lint && pnpm typecheck && pnpm test && (cd apps/composer && uv run pytest -q) && pnpm --filter @vzc/api dryrun`
Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add scripts/deploy.sh assets/stories/README.md docs/lessons.md
git commit -m "chore(deploy): upload story assets; the Christmas asset list; lessons: stories as data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 交接给后续计划

- **第二份（内容）**：即梦调 `CHRISTMAS` 的关键帧与镜头提示词（先 `wide`、`forgetCold`）；生成三个场景的 `ornament.jpg`、`hands.mp4`、`window.mp4`、`music.m4a`；`eval/` 跑一轮（≤ $10），结论写进 `docs/model-eval.md`；通过的场景改 `live: true`。
- **第三份（上线）**：`/ai-christmas-video` 页面（H1 先用哥飞工具核实）、`StoryTool` 接 `story` 参数与「谁会忘记」文案、定价页圣诞一行、首页入口卡片、`node scripts/stripe-setup.ts test --yes` / `live --yes`、2 条样片、端到端测试卡下单、上线清单；上线前补上 `SharedFilm.story`、`apps/web/src/lib/ledger.ts` 对 christmas1 的文案（不是 "2 videos"）、`parts.tsx` 圣诞镜头 6–8 的阶段标签、`routes/stories.ts` 记录的 promptVersion 按故事区分；并补一条测试：圣诞场景上线时 `pet` 被拒、显式 `story` 被写入。
- **上线开关**：圣诞场景的 `live: true` 只在第三份计划里切换，而且必须先跑 `node scripts/stripe-setup.ts test --yes` 和 `live --yes`、把 `christmas1` 的价格写进两份 wrangler 配置之后再切——这个开关同时控制生产环境能否下圣诞单（可用已有积分支付）、`christmas1` 是否在售、以及 `apps/api/test/configs.test.ts` 对每个在售商品都要有 Stripe 价格的检查；第二份计划调提示词和做素材期间保持 `live: false`，测试站验证用单测里临时打开或直接用运行器跑。
