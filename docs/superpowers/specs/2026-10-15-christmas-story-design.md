# 新故事「50 Christmases」设计规格

- 日期：2026-10-15
- 状态：待用户审阅
- 上级文档：`2026-10-14-videozombiecouple-design.md`（本文只写新增与改动；没提到的沿用原规格）

## 1. 目标与边界

### 1.1 要做什么
在 videozombiecouple.com 上新增第二个故事：用户上传两张照片，生成一条 32 秒的竖屏圣诞短片「50 Christmases」——五十年后的平安夜，一方已经认不出另一方；记得的那位挂上两人第一个圣诞的挂饰，树灯亮起，对方想起来了；硬切到年轻时（就是上传照片里的样子）的回忆，再回到苦乐参半的现在。单价 $9.99。

### 1.2 为什么是它（调研 2026-10-15）
- Google Trends（美国，同一次查询）：「ai christmas」2025 年峰值是「ai halloween」的约 4.5 倍，比 2024 年涨约 7 倍；高峰在 12 月 21–27 日，11 月开始起量。
- 圣诞类搜索以照片 / 贺卡为主（上升最快：ai christmas card generator、ai christmas photo prompt），纯「视频」词量小。
- 丧尸趋势全球热度 9 月 20 日见顶，已回落；两人模板爆款一个接一个（丧尸 9/18–20，Hotel Lobby 9/23–26），网站需要第二个故事。
- 结构沿用丧尸片打动人的四步：对方变了 → 你不放手 → 相认 → 硬切回忆。

### 1.3 已定决策
| 决策 | 结论 |
|---|---|
| 放在哪 | 本站新页面 `/ai-christmas-video`，复用账号、支付、生成流程 |
| 计价 | 积分仍是内部货币；圣诞片扣 20 积分；新增商品「1 条圣诞片 $9.99（20 积分）」；已有积分也能用 |
| 时长 | 30 秒正片（9 个镜头）+ 2 秒字幕卡叠在最后一镜上 = 32 秒 |
| 架构 | 「故事」变成 catalog 里的一份数据，生成流程按数据排顺序（§4，方案 A） |
| 首版范围 | 只做情侣（human）；宠物版下一期 |
| 上线目标 | 2026-11-05 |

### 1.4 不做（YAGNI）
宠物版、用户自定义字幕文案（如「50th」改数字）、多语言、后台可视化编辑故事、免费预览（全站仍是纯付费，样片即预览）、丧尸片涨价或加长。

## 2. 故事与分镜

### 2.1 人物与道具
- **角色**：沿用「谁变丧尸」开关，改称「谁会忘记」。下文以「照片 2 忘记 / 照片 1 记得」为例。数据字段仍是 `survivorKey`（记得的一方）/ `infectedKey`（忘记的一方），只换页面文案。
- **老年**：两人约 75–80 岁；银白头发、眼角额头深纹、手背老年斑；脸型、五官、发际线保持本人；不戴眼镜。服装全程不变——她：奶油色粗针开衫 + 红绿格子毯；他：深海军蓝毛衣 + 浅色衬衫领。
- **年轻**：上传照片里的脸与发型；冬装——她：酒红色毛衣；他：灰色连帽衫。
- **三件道具（前后呼应）**：
  | 道具 | 出现 | 作用 |
  |---|---|---|
  | 系金丝带的红色玻璃心形挂饰 | 镜头 4、5、7 | 第一个圣诞的信物 |
  | 一对白色珐琅马克杯（杯沿掉漆） | 镜头 3、7（新的）、8 | 五十年前就是这对杯子 |
  | 圣诞树灯 暗 → 亮 | 镜头 3 → 5 → 8 | 灯亮 = 想起你 |
- **调色**：`cold`（月光蓝灰）→ `amber`（钨丝灯琥珀）→ `golden`（回忆：偏过曝金色 + 颗粒 + 光晕）→ `amber-dawn`（琥珀室内 + 窗外泛白晨光）。

### 2.2 分镜（以「雪夜木屋」为例）

开头先给痛点（她不认得他），原因延后揭晓；每个转场靠视线、动作或画面接力。

| # | 时间 | 首帧 | 调色 | 画面与动作 | 运镜 | 声音 | 接下一镜 |
|---|---|---|---|---|---|---|---|
| 1 | 0:00–0:03 | 她·冷光特写 | cold | 0–1s 转头看他；1–2s 对陌生人那样客气地笑；2–3s 转回窗外，眼神空了。叠字幕①。 | 固定，浅景深 | 挂钟滴答、风声、钢琴单音 | 视线落向画外的他 |
| 2 | 0:03–0:06 | 他·冷光特写 | cold | 0–1s 嘴角勉强扬起；1–2s 眼眶湿（不流泪）；2–3s 慢慢低头 | 极慢推近 | 大提琴长音 | 低头 → 下一镜放杯子 |
| 3 | 0:06–0:10 | 客厅全景 | cold | 他把一只白马克杯轻放在她手边，热气升起；她仍望窗外；他转头看向暗着的圣诞树 | 固定，微推 | 地板吱呀、钢琴前三个音 | 看向树 → 下一镜他手里的东西 |
| 4 | 0:10–0:13 | 手捧挂饰（场景素材） | cold | 皱纹老手掀开褪色红纸盒，拇指擦过心形挂饰，把它提起出画。叠字幕②。 | 俯拍固定 | 纸盒摩擦声；配乐静音 | 挂饰出画 → 下一镜入画 |
| 5 | 0:13–0:17 | 圣诞树前 | cold→amber | 挂饰挂上齐眼高的树枝轻晃；树灯从挂饰旁一盏接一盏向外亮起；暖光一路扫到画面深处的她 | 缓慢横移，从他到她 | 每盏灯一声钟琴，音高上行；弦乐渐强 | 光扫到她 → 下一镜被照亮的她 |
| 6 | 0:17–0:20 | 她·暖光特写 | amber | 与镜头 1 同机位同构图，只换光；眼神聚焦，泪涌，嘴唇轻颤，抬手伸向他的脸 | 固定 | 弦乐停在最高音 | 手碰到脸 → **白闪 3–4 帧硬切** |
| 7 | 0:20–0:24 | 年轻回忆 | golden | 金色午后的小公寓，墙边搬家纸箱，窗台一对新马克杯，一米高小树上挂着心形挂饰；**年轻的她一只手摸着他的脸**，两人笑；他低头亲她额头 | 手持感轻晃，慢后拉 | 年轻的笑声提前 0.5s 进；鼓点落在切点；主旋律完整奏出 | 亲额头 → 下一镜额头相贴 |
| 8 | 0:24–0:28 | 尾声相拥 | amber-dawn | 老年两人在亮着的树旁额头相贴，她的手还贴在他脸上，闭眼慢慢左右摇晃 | 缓慢拉远升高，露出亮着的树和窗台两只冒热气的杯子，拉到窗边 | 主旋律收束 | 拉到窗边 → 窗外 |
| 9 | 0:28–0:32 | 窗外雪景（场景素材） | amber-dawn | 从屋外看，窗里树灯亮着，雪在下，天快亮。0:30 起叠字幕卡 | 固定 | 钢琴单音延续到结尾 | — |

**字幕**（composer 叠加，白色衬线字，带柔和暗底，位置在画面上三分之一）：
| 时间 | 文案 |
|---|---|
| 0:00–0:05 | ① `Our 50th Christmas. Today, you asked me my name.`（不用性别代词，见 §2.3） |
| 0:10–0:13 | ② `So I brought back our first one.` |
| 0:30–0:32 | 字幕卡：`Our first Christmas · {year}`，0:31 淡入第二行 `and every one after.`，最底下名字 |

`{year}` 取用户填的日期里的年份；没填用下单当年。

### 2.3 字幕的人称
字幕①用「you」指忘记的一方，适用于任何组合，不需要猜性别。字幕②不变。

### 2.4 场景
每个场景一包：冷段 / 暖段 / 回忆的环境描述、两段场景素材（手捧挂饰、窗外雪景）、挂饰参考图、32 秒音轨。

| 场景 id | 现在（老年） | 回忆（年轻） | 首版 |
|---|---|---|---|
| `snow-cabin` | 雪夜木屋客厅 | 第一间小公寓 | 上线 |
| `city-flat` | 城市老公寓，窗外城市雪景 | 圣诞集市 | 评测通过后上线 |
| `farmhouse` | 农舍，窗外雪原 | 雪地里砍圣诞树 | 评测通过后上线 |

## 3. 关键帧与场景素材

### 3.1 每单生成的关键帧
以客厅全景为基准，衰老样貌、服装、光线都从它继承。

| id | 用于镜头 | 参考图 | 候选 | 挑图 |
|---|---|---|---|---|
| `wide` | 3 | 照片 1、照片 2 | 2 | 人脸相似度（两人），取高 |
| `memory` | 7 | 照片 1、照片 2、挂饰参考图 | 2 | 人脸相似度（两人），取高 |
| `herCold` | 1 | 照片 2、wide | 1 | — |
| `hisCold` | 2 | 照片 1、wide | 1 | — |
| `tree` | 5 | 照片 1、照片 2、wide、挂饰参考图 | 1 | — |
| `herWarm` | 6 | 照片 2、herCold | 1 | — |
| `embrace` | 8 | 照片 1、照片 2、tree | 1 | — |

共 9 张（含 4 张候选）。老年脸与原照片的相似度天然偏低，**只用于两张候选里挑高的，不设及格线**。

### 3.2 每个场景共用的素材（提前生成一次）
| 素材 | 内容 |
|---|---|
| 挂饰参考图 | 红色玻璃心形挂饰、金丝带，纯背景 |
| 镜头 4 视频 | 手捧挂饰（关键帧 + 图生视频，成片 3 秒） |
| 镜头 9 视频 | 窗外雪景（关键帧 + 图生视频，成片 4 秒） |
| 音轨 | 32 秒成品：配乐 + 音效（挂钟、风、地板、纸盒、钟琴、笑声），时间点按 §2.2 卡好；suno.com 生成配乐（Suno Pro 订阅期内，许可记录写进 `assets/music/README.md`），音效与混音按固定时间线做成一条 |

素材放 R2 `assets/stories/christmas/<scene>/`，部署时上传（同现有 `assets/music/`）。生成脚本放 `eval/`，不进 workspace。

### 3.3 提示词要点（定稿在即梦里调，见 §8）
- 老年：`aged to about 78, silver-white hair, deep wrinkles at the eyes and forehead, age spots on the hands — but the exact same face shape, features and hairline as IMAGE N, instantly recognizable`。
- 每张关键帧带挂饰参考图时写 `the red glass heart ornament with a gold ribbon exactly as in IMAGE K`。
- 固定约束：`No text, no glasses, no exaggerated crying, no distorted hands.`
- 镜头统一加 `Subtle, restrained motion. Faces stay consistent with the reference people.`

## 4. 架构：故事即数据

### 4.1 catalog
新增 `packages/catalog/src/stories/`：

```ts
type FrameRef =
  | { photo: 1 | 2 }          // 用户照片（1 = survivorKey，2 = infectedKey）
  | { frame: string }         // 本单的另一张关键帧（取挑中的那张）
  | { asset: string };        // 场景共用的静态图

type Keyframe = {
  id: string;
  refs: FrameRef[];
  candidates: number;          // ≥ 2 时会生成一个 score 步骤
  faces: ("survivor" | "infected")[];  // 挑图时比对谁
  prompt: (scene: SceneId, kind: Kind) => string;
};

type Shot = {
  id: number;
  sec: number;
  first: { frame: string } | { clip: string };  // clip = 场景共用的成片视频，不发起生成
  last?: { frame: string };
  grade: Grade;
  anchor?: "start" | "end";
  flashIn?: boolean;           // 进入这一镜时白闪
  prompt?: (scene: SceneId, kind: Kind) => string;
};

type Story = {
  id: "zombie" | "christmas";
  credits: number;             // zombie 10 · christmas 20
  kinds: Kind[];               // christmas 首版只有 human
  roles: { survivor: string; infected: string };  // 页面文案键
  scenes: Record<string, StoryScene>;             // 环境描述、静态素材 key、音轨 key、live
  keyframes: Keyframe[];
  storyboard: (kind: Kind) => Shot[];
  overlays: { text: string; start: number; end: number }[];
  endTitle: { line1: (v: { year: string }) => string; line2?: string; start: number };
  holdSec: number;             // 最后一镜之后再停多久（zombie 1；christmas 0，字幕卡叠在镜头 9 上）
};
```

- `stories/zombie.ts`：把现有 `story.ts` 的内容原样搬进来（A/B/C、5 个镜头、提示词、`storyboard(kind)` 的宠物分支）。**行为不变**，由快照测试守护（§9）。
- `stories/christmas.ts`：本文 §2–§3 的数据。
- `stories/index.ts`：`STORIES`、`story(id)`。`story.ts` 保留现有导出名作为 zombie 的别名，避免一次改太多调用方；`PHOTO` / `portraitPrompt`（免费丧尸滤镜）不动。
- `tiers.ts`：`TIERS.video.credits` 改为按故事取 `story(id).credits`。
- `facts.ts`：按故事输出 `story.<id>.seconds`、`story.<id>.usd`、`story.<id>.credits`。
- `pricing.ts`：
  - `WAFFO_FEE` 换成 `PAYMENT_FEE`，按 Stripe Managed Payments：`{ rate: 0.029 + 0.035, fixedUsd: 0.3, payoutRate: 0 }`（国际卡另加 1.5%，用 `rate` 的保守值 0.079 校验）。
  - `storyCostUsd(storyId)` 按故事的关键帧数与非 clip 镜头秒数算。
  - `pricingGuard` 对每个故事、每个可用来买它的商品分别校验「净收入 ≥ 2 × 全成本」。
- `plans.ts`：`PACKS` 加 `{ id: "christmas1", credits: 20, usd: 9.99, productKey: "christmas1" }`，并标记它属于圣诞页（定价页分组展示用）。

### 4.2 API
- `StorySpec` 加 `story: StoryId`；读旧记录时缺省为 `"zombie"`。
- `CreateStorySchema` 加 `story`（默认 zombie），并校验 `scene` 属于该故事、`kind` 在该故事的 `kinds` 里。
- `graph.ts`：`videoSteps(story)` 按 `keyframes` 生成步骤——每个 `candidates ≥ 2` 的关键帧生成 N 个候选步骤 + 一个 `score:<id>`；关键帧的依赖来自 `refs` 里的 `{frame}`；镜头依赖其 `first/last` 引用的关键帧；`{clip}` 镜头不生成步骤，合成时直接取素材。`readySteps` / `phaseOutcome` 里写死的 `A`/`C` 改成「所有带候选的关键帧」。
- `kieInputFor`：按 `refs` 依次解析为签名 URL（照片 / 挑中的关键帧 / 静态素材）。
- `picks`：键从 `FrameId` 放宽为 `string`。
- `charge.ts`：预扣 `story(spec.story).credits`。
- composer 客户端：传 `overlays`、`endTitle`、每镜 `grade`/`anchor`/`flashIn`、`holdSec`、clip 的签名 URL。
- 邮件与分享文案按故事取。

### 4.3 composer
- 新调色：`amber`、`golden`、`amber-dawn`（`grade.py` 的 `GRADES`）。`cold`→`amber` 的镜头 5 用 `cold` 起、在镜头内由画面本身完成亮灯，不做调色渐变。
- 叠字幕：`overlays[]` 按时间段叠 PNG（复用 `caption.py` 的字体与暗底，单行、上三分之一）。
- 白闪：`flashIn` 的镜头开头叠 3–4 帧白场渐隐。
- 字幕卡：`holdSec = 0` 时不冻结末帧，字幕卡从 `endTitle.start` 起叠在最后一镜上，第二行延迟 1s 淡入。
- 音轨：按成片总长截取，结尾淡出（现有逻辑，长度改为跟片长走）。
- `/compose` 的 400 校验放开到新调色与新字段。

### 4.4 页面
- `/ai-christmas-video`：首屏制作工具 → 样片 → 三步用法 → 故事说明 → FAQ；WebApplication + FAQPage + HowTo + BreadcrumbList + VideoObject；更新 `llms.txt`、sitemap，部署后推 IndexNow。H1 对准的词写页面前用哥飞工具核实（候选：christmas couple video、ai christmas video）。
- 首页：主打不变，加一块「New: 50 Christmases」入口卡片。
- 定价页：丧尸片 1 / 3 / 5 条装照旧；圣诞片单独一行「$9.99 / film」，小字「Your video credits work too: a Christmas film uses 2.」
- 制作工具 `StoryTool` 接收 `story` 参数：角色文案（Who remembers / Who forgets）、场景列表、下单商品 `christmas1`。
- 样片：只用 AI 合成人物（`eval/data/personas`），在测试站做 2 条。
- 页面数字全部从 catalog 的 facts 读。

## 5. 生成流程与耗时

```
付款前：score:sources（同现有）
付款后：
  第 1 轮  kf:wide:1..2   kf:memory:1..2
           score:wide      score:memory
  第 2 轮  kf:herCold  kf:hisCold  kf:tree          （依赖 wide 的挑选）
  第 3 轮  kf:herWarm（依赖 herCold）  kf:embrace（依赖 tree）
  镜头     shot:1,2,3,5,6,7,8 各在首帧就绪后开始；shot:4、shot:9 用场景素材
  合成     compose
```

最慢一条线：wide → herCold → herWarm → shot:6 → compose，按评测 p50 约 6–7 分钟（丧尸片约 5 分钟）。

## 6. 成本与定价（默认路由：GPT Image 2 $0.015/张，Kling 3.0 std 约 $0.07/秒）

| 项 | 数量 | 费用 |
|---|---|---|
| 关键帧 | 9 张 | $0.14 |
| 镜头 | 7 段共 25 秒（镜头 1–3、5–8） | $1.75 |
| 模型费 | | 约 $1.89 |
| 全成本 | ×1.3 免费重做 + $0.30 测试摊销 | 约 $2.76 |

| 买法 | 净收入 / 条（Stripe 6.4% + $0.30） | 倍数 |
|---|---|---|
| christmas1 $9.99 | 约 $9.05 | 3.3× |
| pack5 积分（$21.99 / 50 积分 → 20 积分） | 约 $8.1（国际卡按 7.9% 算约 $8.0） | 2.9× |

场景素材一次性成本（每个场景约 2 张关键帧 + 7 秒视频 + 音轨）计入测试费。

## 7. 失败处理
全部沿用现有机制：每步按路由表换备用模型；候选坏一张用另一张；任一非候选步骤最终失败 → 整单失败，20 积分预扣全退，可重新生成；免费重做 1 次（`REMAKES_PER_FILM`）；改名字 / 日期只重跑合成。

## 8. 上线顺序

| 时间 | 内容 | 关卡 |
|---|---|---|
| 10/16–10/22 | ① 即梦调提示词，先调 `wide` 与 `herCold`（老年脸能否认出本人）。② catalog 改多故事，zombie 行为不变 | 10/22 前老年脸认不出本人 → 停下重新评估故事 |
| 10/23–10/29 | christmas 故事数据、通用 graph、composer 新功能；生成 `snow-cabin` 场景素材与音轨；`eval/` 跑一轮（≤ $10） | 测试站跑出完整 32 秒成片 |
| 10/30–11/05 | 页面、样片、`node scripts/stripe-setup.ts test --yes` 后 `live --yes` 建 `christmas1`；测试卡端到端；上线后在 SunBrowser 的 Stripe 后台核对商品与首单 | 上线清单 |

提示词按记忆规则在即梦里调（JXA 在 Chrome 新标签页执行 JS，不截屏、不抢鼠标，见 Obsidian「23-用即梦调图像提示词」），定稿后才用测试站真实流程跑。

## 9. 测试
- **catalog**：每个故事镜头时长之和 = 正片长；所有 `{frame}` 引用存在、关键帧依赖无环；`{clip}`/`{asset}` 都登记在场景里；**zombie 搬家前后提示词、分镜、成本逐项相等（快照）**；每个故事通过 `pricingGuard`；facts 输出圣诞片 32 秒、$9.99。
- **API**：按故事扣 10 / 20 积分；christmas 的步骤图与依赖正确，clip 镜头不发起 kie；旧记录无 `story` 字段按 zombie 跑完；中途失败退全款；`CreateStorySchema` 拒绝不属于该故事的场景与 kind。
- **composer（pytest）**：32 秒、720×1280、24fps；字幕叠在指定时间段；白闪出现在镜头 7 开头的帧；`holdSec = 0` 时不冻结末帧；新调色可用。
- **E2E**：测试站上传 → 测试卡付款 christmas1 → 生成 → 下载。

## 10. 风险与退路（即梦里先验证）
| 风险 | 退路 |
|---|---|
| 老年脸认不出本人 | 多轮调衰老程度（同丧尸妆「太重就认不出」）；仍不行则停下评估（§8 关卡） |
| 镜头 1 的「客气微笑」拍不出 | 改为「看他一眼，没有反应，转回窗外」 |
| 镜头 5 树灯不按顺序亮 | 整棵树渐亮 |
| 镜头 6 抬手伸出画外时手变形 | 只保留眼神变化与泪光；白闪切点改在泪光那一刻 |
| 挂饰几个镜头里不一样 | 每张相关关键帧都带挂饰参考图 |
| 内容审核误判（老人、眼泪） | 按现有错误分类换模型重试 |
