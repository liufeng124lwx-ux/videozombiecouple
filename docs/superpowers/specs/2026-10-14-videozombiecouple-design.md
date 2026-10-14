# VideoZombieCouple 设计规格

- 日期：2026-10-14
- 域名：videozombiecouple.com（已注册）
- 状态：待用户审阅

## 1. 目标与边界

### 1.1 要做什么
用户上传两张照片（情侣，或人 + 宠物），网站生成一条 12 秒竖屏的「丧尸末日爱情短片」：一方已变成丧尸，另一方举枪下不了手，放下枪拥抱，在拥抱的瞬间硬切到两人健康时的暖色回忆。这个玩法 2026-09 底在 TikTok / Instagram 爆发（Google Trends 2026-09-27 那周起持续有热度）。

### 1.2 成功标准
- 在热度窗口期（预计几周到几个月）内上线并拿到排名与付费。
- 第 8 周：首页核心词 `zombie video couple` 进 Google 前 20。
- 第 12 周：曝光仍约等于 0 或无付费 → 复盘。
- 趋势止损：Google Trends 连续 3 周低于峰值 20% → 停止新功能，只维护。

### 1.3 已定决策
| 决策 | 结论 |
|---|---|
| 站点定位 | 单模板专站，先快上线；模板数据驱动，但首版只有丧尸情侣 |
| 生成方式 | 关键帧 → 分镜头图生视频 → ffmpeg 拼接 |
| 变现 | 免费关键帧预览 + 按条付费（次数包，无订阅） |
| 语言 | 只做英文，保留 i18n 结构 |
| 代码起点 | 复制 unblurpix 仓库后裁剪 |
| 后期合成 | Cloudflare Containers 跑 ffmpeg |
| 上线节奏 | 分两期（见 §9） |

### 1.4 不做（YAGNI）
订阅、多语言、公开用户作品墙、多模板框架 UI、浏览器端 ffmpeg、1080p / 加长版（catalog 留口子，首版不卖）。

## 2. 竞品基线（2026-10-14 调研）

| 站 | 做法 | 输出 | 单条价格 |
|---|---|---|---|
| imageat.com | 原爆款 24 秒视频做模板换脸（Nano Banana 2 出丧尸头像 + Higgsfield 动作迁移） | 24s 2:3 480/720p | 720p 约 $30，无免费 |
| media.io | 给 4 条可复制提示词，走通用参考图生视频 | 10s 9:16 | 约 10 积分/条，月付 $7.99 起 |
| kavel.ai | 剧情写好一键生成，Seedance 2.0 Mini | 4–15s，带声 | 单条 $9.99 |
| renoise.ai | 同上，Seedance 2.0 Mini | 8s 480p 无声 | 约 $0.67 |
| viddo.ai | 单人变丧尸特效 + 教程博客 | — | 未取到 |

共同弱点：一次出整片导致脸漂、两张脸混合、转场糊；没有展示真实生成成品；无配乐或配乐不对点。我们的差异：关键帧锁脸 + 分镜 + 后期对点配乐 + 名字字幕卡 + 先免费看关键帧再付费。

## 3. 整体架构

```
videozombiecouple/（复制 unblurpix 后裁剪）
├─ apps/web        Astro 静态站 + Preact 岛
├─ apps/api        Hono on Workers
│   └─ DO：RateLimiter / Dispatcher / JobRunner（多阶段）/ Wallet
├─ apps/composer   Cloudflare Container：/score（人脸/宠物相似度、年龄估计）、/compose（ffmpeg）
├─ packages/catalog    唯一数据源：scenes、storyboard、prompts、音轨、LUT、价格、限额、页面
├─ packages/providers  kie 适配器：新增图像编辑、图生视频入参映射
├─ packages/contracts  错误码、校验、埋点事件名
├─ packages/i18n       只保留 en
└─ eval/               关键帧与视频评测
```

### 3.1 从 unblurpix 沿用
登录（邮箱验证码 / magic link / Google OAuth）、游客身份与合并、Turnstile 通行证、RateLimiter、Wallet 积分账本（reserve → commit / release）、Waffo 结账与 webhook、路由表 + 熔断 + 失败换模型、kie 错误分类、运维告警与 cron、admin（Cloudflare Access）、CI / 部署流水线、check-dist、catalog 驱动的页面与 MDX、埋点、法律页、暗房设计 token、MediaPipe 人脸检测。

### 3.2 删除
清晰度诊断、补边 / 比例对齐、前后对比画布、本地图片工具与编辑器（jSquash、gif、heic）、保真检查、7 种非英文内容。

### 3.3 新写
多阶段 JobRunner、双图上传、kie 视频入参映射、composer 容器、视频存储与播放、场景 / 分镜 catalog、评测脚本。

### 3.4 数据
- D1：沿用 jobs、attempts、credit_* 等表；新增 `job_stages`（job_id、stage、状态、尝试次数、成本、产物 R2 key）。
- R2 前缀与保留期：`in/` 1 天、`kf/` 3 天、`shot/` 3 天、`out/` 14 天、`keep/` 沿用。
- 人脸 / 宠物特征向量只在容器内存中计算，不落库、不写日志。

### 3.5 环境与账号
staging / production 两套；域名 `videozombiecouple.com`、`api.`、`staging.`、`api-staging.`。Waffo、GA4、Sentry、Clarity、Google OAuth、kie 子 key 全部单独开，不与其他站共用。Cloudflare 与 video2mp4 同账号，资源名以 `vzc-` 为前缀。

## 4. 生成流程

### 4.1 用户流程
1. 上传 2 张照片；选项：谁变丧尸（宠物版开启时锁定为宠物变丧尸）、宠物版、场景、名字与日期（可选）。
2. 免费预览（需登录）：约 30–60 秒后看到关键帧 A（对峙）与 C（回忆）。
3. 满意 → 点 “Make my video”，扣 1 次，生成完整视频（几分钟）。
4. 完成后页面通知；已离开页面则发邮件。可下载、可分享（分享页 noindex）。

### 4.2 后台阶段（JobRunner 用 DO alarm 推进，状态写 `job_stages`）

| 阶段 | 内容 | 执行位置 / 模型候选 | 失败处理 |
|---|---|---|---|
| S0 预处理 | 每张只有一张人脸（宠物图检测是否为猫狗）、按脸裁剪、放大、去 EXIF、重编码 JPEG | 浏览器 MediaPipe + 服务端文件头校验 | 提示换照片，不扣预览次数 |
| S0b 年龄估计 | 明显未成年 → 拒绝 | composer `/score` | 拒绝并提示 |
| S1 关键帧 A、C | 每张 2 个候选（同时参考两张原图） | kie 图像编辑（Nano Banana / Seedream 等，评测定） | 换模型重试；内容误判换模型再试 1 次 |
| S2 选图 | 人：人脸相似度；宠物：CLIP 图像相似度；取最高分 | composer `/score` | 低于阈值自动重做 1 次，仍低则照常展示并提示可重做 |
| — | 展示预览，等待付费 | — | — |
| S3 关键帧 B | 拥抱帧：以 C 为姿势与机位参考、以 A 为场景与丧尸妆参考 | kie 图像编辑 | 同 S1 |
| S4 镜头 | 4 段图生视频并行（见 §5） | kie 图生视频（Seedance / Kling 等，评测定） | 单镜头失败或超时 → 换模型只重做该镜头 |
| S5 合成 | 按分镜拼接、冷暖段分别套 LUT、叠音轨（鼓点对切点）、字幕卡、角落小 logo；输出 9:16 720p mp4 + 封面图 | composer `/compose` | 重试 2 次 |
| S6 交付 | 写 `out/`、通知、记成本 | api | — |

### 4.3 规则
- 同一镜头不出现健康脸与丧尸脸同框。
- 积分在 S3 开始时预扣；S6 未完成则全额退还。
- 镜头级缓存：改名字 / 日期只重跑 S5。
- 超时按评测得到的 p90 设置；`STALE_INFLIGHT_MS` 等常量按视频时长重新定。
- kie 结果立即转存到自己的 R2（kie 结果文件会过期）；给 kie 的输入用 1 小时 R2 预签名链接。
- kie 响应按 body 的 `code` 判断成败，不只看 HTTP 状态。

## 5. 分镜与提示词（初稿，评测前未验证）

### 5.1 分镜（12 秒，9:16，场景「木屋 → 麦田」）

| # | 时长 | 首帧 | 画面 | 运镜 | 声音 |
|---|---|---|---|---|---|
| 1 | 0–3s | A | 昏暗木屋，幸存者举枪微抖，丧尸伴侣在门口逆光转头 | 肩后缓慢推近 | 低频嗡鸣、心跳 |
| 2 | 3–5s | A | 握枪的手特写，手指离开扳机（宠物版：手放低手电筒） | 缓慢推近，浅景深 | 第一个音进来 |
| 3 | 5–8s | A → B | 放下枪张开双臂，两人抱紧 | 缓慢环绕 | 渐强 |
| ✂ | 8s | B → C | 匹配剪辑（同姿势同机位） | — | 鼓点落在切点 |
| 4 | 8–11s | C | 麦田日落，两人健康，抱着笑，风吹头发与麦穗 | 慢动作拉远 | 主旋律 |
| 5 | 11–12s | 后期 | 字幕卡 “Even at the end of the world.” + 名字与日期 | — | 余音 |

镜头 3 用 A 起、B 止（所有入选视频模型都支持首尾帧）；合成时保留该片段的**结尾**。镜头 2 原为幸存者面部特写，因关键帧 A 里幸存者是背侧位而改为手部特写。各模型最短时长不足时向上取整生成，合成时剪到目标时长。评测结论见 `docs/model-eval.md`。

### 5.2 提示词结构
画面风格 → 场景 → 角色（引用 IMAGE 1 / IMAGE 2）→ 一个动作 → 运镜 → 光线 → 约束。视频镜头统一包含 “Faces stay consistent” 与 “subtle, restrained motion”。丧尸妆写具体部位（pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing），并要求 “clearly recognizable as IMAGE N”。负面约束固定：no blood, no gore, no biting, no gunfire, no text。宠物版丧尸妆只写 “cloudy eyes, patchy fur”。

### 5.3 提示词初稿
- 关键帧 A：`Cinematic film still, vertical 9:16. Inside a dim abandoned wooden cabin, cold blue moonlight through broken boards, dust in the air, 35mm film grain. Person from IMAGE 1 stands in foreground, back three-quarter view, aiming a pistol, wearing a worn olive jacket. Person from IMAGE 2 stands in the doorway, backlit, infected: pale grey-green skin, cloudy white eyes, dark veins at the temples, torn clothing — but face shape, hairstyle and features clearly recognizable as IMAGE 2. Keep both identities exact. No blood, no gore, no text.`
- 关键帧 C：`Golden wheat field at sunset, warm backlight, lens flare, soft haze. Both people healthy and smiling, clean casual clothes, embracing, front three-quarter view. Person from IMAGE 1 and person from IMAGE 2, identities exact.`
- 关键帧 B：`Same pose and camera angle as the reference embrace frame. Inside the same dim cabin as the scene reference, cold blue moonlight. Person from IMAGE 1 embraces the infected person from IMAGE 2 (infected look as in the scene reference), identities exact. No blood, no gore.`
- 镜头 1：`Slow push-in from behind the survivor's shoulder. The survivor's hands tremble slightly on the pistol. The infected partner slowly turns their head toward camera. Dust particles drift in moonlight. Subtle, restrained motion. Faces stay consistent. No gunfire, no lunging, no blood, no camera shake.`
- 镜头 3：`The survivor slowly lowers the pistol, lets it fall, and opens both arms. The infected partner steps forward into the embrace; they hold each other tightly. Slow orbit camera. Emotional, gentle. Faces stay consistent. No biting, no blood.`
- 镜头 4：`Slow-motion pull back. The couple laughs while hugging, wind moves their hair and the wheat. Golden hour sunlight, warm glow. Natural, joyful motion. Faces stay consistent.`

### 5.4 场景（catalog 中每个场景一包：提示词、LUT、音轨、分镜时长）
- 第一期：`cabin-wheat`（木屋 → 麦田）。
- 第二期：`rain-chapel`（雨夜城市 → 婚礼教堂）、`lighthouse-beach`（海边灯塔 → 海滩）。

## 6. 页面与 SEO

| 页面 | 核心词 / H1 | 期数 |
|---|---|---|
| `/` | Zombie Video Couple（兼顾 zombie couple ai video） | 一期 |
| `/zombie-love-story-ai` | Zombie Love Story AI | 一期 |
| `/pricing` | — | 一期 |
| `/terms` `/privacy` `/refund` `/dmca` `/contact` | — | 一期 |
| `/pet-zombie-video` | Pet Zombie Video | 二期 |
| `/zombie-love-story-prompts` | Zombie Love Story Prompts | 二期 |

- 首页结构：首屏工具 → 样片墙 → 玩法说明 → 3 步用法 → 4 个节拍图解 → 挑照片建议 → 竞品对比 → FAQ。内页复用同一工具组件，用参数预设选项。
- 规则：每页一个 H1 且等于 catalog 中的 h1；Title 约 60 字符含核心词与年份；Description 150–160 字符；canonical 自指；WebApplication + FAQPage + HowTo + BreadcrumbList，样片加 VideoObject；sitemap、robots 放行 AI 爬虫、`llms.txt`、OG 图、IndexNow、GSC（网域资源）、Bing。
- 样片只用授权模特或 AI 生成的人物，不放用户作品。
- 性能：手机 PageSpeed ≥95、CLS = 0；首屏 H1 第一帧可见。
- 视觉：暗房深色体系，强调色由黄色改为「感染绿 + 少量暖橙」，实施阶段用 refero-design 调研后定稿。
- 埋点新增：`preview_start`、`preview_done`、`video_purchase`、`video_done`。
- 新页面按 GSC 中排 11–20 名的词分批补。

## 7. 计费与定价
- 对用户展示「视频次数」；后台 1 次 = N 积分，N 在 catalog。
- 次数包（草案，评测后按毛利 ≥70% 校准；单条成本 > $1.5 则整体上调）：

| 包 | 价格 | 单条 |
|---|---|---|
| 1 条 | $4.99 | $4.99 |
| 3 条（主推） | $11.99 | $4.00 |
| 10 条 | $29.99 | $3.00 |

- 次数永久有效。每条付费视频含：720p、无大水印（角落小 logo）、免费改 1 次名字 / 日期、付费后免费重做 1 次关键帧、成片保存 14 天。
- 免费预览：必须登录；每天 3 次；每张关键帧 2 个候选。评测测出单次预览成本，按目标转化率倒推上限写进 catalog。游客只能看样片。
- 收款：Waffo 独立商户（沿用结账、验签、幂等记账、`waffo-setup.ts`）；Creem 备好环境变量可随时切换。
- 退款：生成失败自动退次数；7 天内未用次数可退款，退款时扣回。
- 付费前必须登录；游客数据登录后合并。

## 8. 风控、合规与运维

### 8.1 内容与合规
- 上传前勾选「本人或已获授权的成年人照片」；年龄估计拒绝明显未成年人。
- 提示词写死禁止血、伤口、咬、开枪、裸露；kie 内容拒绝按错误分类换模型重试 1 次，仍失败提示换照片。
- 用户视频默认私有；分享页 noindex。
- 不使用原爆款视频画面与音乐；音轨用免版权或 AI 生成，许可证留档；页面声明与原视频作者及 TikTok 无关。
- 特征向量不落库；Privacy 写明：原图 1 天删除、成片 14 天删除、特征只在内存中计算、不用于训练。
- 法律页主体 Arrayon Inc；DMCA 登记加本站别名。

### 8.2 防刷与成本
- Turnstile 通行证、RateLimiter、可疑身份、一次性邮箱拦截。
- 本站专用 kie 子 key，kie 后台设日消费上限；代码中日花费到上限则暂停免费预览，付费任务照常。
- 每阶段成本记 Analytics Engine；单条成本、日总花费、各阶段失败率超阈值告警。

### 8.3 运维
- 沿用 cron：kie 余额告警、D1 周备份、R2 生命周期、隐私匿名化。
- 新增 runbook：composer 容器故障（任务停在 S4 完成，恢复后重跑 S5）；视频模型下架（路由表关闭，自动切备用）。
- 上线清单照搬 unblurpix，另加容器健康检查、真实视频端到端冒烟。

## 9. 分期

### 第一期（上线）
- 场景 `cabin-wheat`；谁变丧尸可切换；名字 + 日期字幕卡。
- 完整的预览 → 付费 → 生成 → 交付流程。
- 页面：`/`、`/zombie-love-story-ai`、`/pricing`、法律页。

### 第二期（上线后 1–2 周）
- 宠物版（锁定宠物为丧尸方，CLIP 相似度选图）。
- 场景 `rain-chapel`、`lighthouse-beach`。
- 页面：`/pet-zombie-video`、`/zombie-love-story-prompts`。

两期代码结构相同，差别只在哪些 catalog 内容通过评测后上线。

## 10. 评测（开发的第一个任务）
1. 在 kie 上确认：哪些图像模型支持多张参考图；哪些视频模型支持首帧 / 首尾帧；各自实际成本（以返回的 `creditsConsumed` 为准）与 p90 耗时。
2. 评测集：10 对不同肤色、发型、性别组合的成人测试照片（授权或 AI 生成），二期加 2 张猫狗照片。真实照片只放 gitignore 目录并去 EXIF。
3. 指标：关键帧人脸相似度、视频各镜头人脸相似度、盲评（像不像本人 / 情绪 / 转场）、单次预览成本、单条视频总成本、失败率。
4. 产出：锁定模型路由、超时、积分 N、免费预览上限、最终定价。
5. 预算：每轮 ≤ $10；改提示词或路由前必须重跑受影响部分。

结论见 `docs/model-eval.md`（2026-10-14：关键帧 GPT Image 2，镜头 Kling 3.0）。

## 11. 测试
- 单元：分镜与提示词组装、kie 图像 / 视频入参映射、积分预扣与退还、阶段状态机、宠物版角色锁定。
- 集成：内存版 D1 / R2 / DO + `FAKE_PROVIDER`（返回假关键帧与镜头）；composer 本地 ffmpeg 测试，用固定素材验证时长、分辨率、音轨、字幕。
- E2E：上传 → 预览 → 测试卡购买 → 生成 → 下载。
- 构建检查：沿用 check-dist（唯一 title / description、单 H1、canonical、无死链、sitemap 只含上线页、OG 图）。

## 12. 并行事项（不阻塞开发，需用户操作）
- 申请 Waffo 独立商户（KYB 可能需数天，是收款上线的关键路径）。
- 重新生成本站专用 kie 子 key，存到 `~/.vzc-secrets/`，线上用 wrangler secret，只走管道写入。
- 新建 GA4、Sentry、Clarity、Google OAuth 应用；Cloudflare Email Routing 建 hello@ / dmca@。
- 准备评测用授权照片。
