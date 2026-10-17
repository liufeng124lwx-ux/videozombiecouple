# 开发与上线经验

做过、踩过、验证过的结论。按主题分组，每条写**现象 → 原因 → 做法**，并注明守护它的测试或检查放在哪里。新坑解决后补在对应主题下。

## 一、性能：慢机器上的动画和渲染

GitHub 的私有仓库 runner 只有 2 核、没有 GPU，所有合成和滤镜都由 CPU 软件渲染。本机（有 GPU）一切正常、CI 却超时，几乎都出在这里。

- **一直循环的动画只用 `transform` 和 `opacity`。**
  - 现象：浏览器检查在 CI 上超时。
  - 原因：动画 `inset`、`filter`、`top` 每帧都要重绘。主按钮角标、处理中的呼吸效果、扫描线都犯过这个错。
  - 做法：改成 transform 或 opacity。例外要登记理由（目前只有流光按钮 `btn-spin`）。
  - 守护：`apps/web/src/styles/motion-cost.test.ts`。
- **屏幕外的区块不绘制。**
  - 做法：首屏以下的 `.section` 加 `content-visibility: auto; contain-intrinsic-size: auto 900px`，作品带、流光按钮这类循环动画在屏幕外就不消耗 CPU。
  - 守护：同上。
- **IntersectionObserver 判断「在屏幕上」要看可见面积，不能只看 `isIntersecting`。**
  - 现象：首屏的 31 个动画在工作台后面一直跑，把 CI 拖垮。
  - 原因：打开工作台时页面正好滚到首屏底边（y = 0），只是贴着边也算 `isIntersecting`，此时 `intersectionRatio` 为 0。
  - 做法：用 `isIntersecting && intersectionRatio > 0`。
  - 守护：`apps/web/src/lib/hero.test.ts`。
- **浏览器检查里开的页面用完就关。**
  - 现象：后面的步骤越跑越慢。
  - 原因：没关的手机端页面会一直渲染，抢走 CI 的 CPU。
  - 做法：`browser-check.ts` 里每个 `newContext` 用完都要 `close()`，超时一律用 `patient()` 放宽。
- **布局规则要限定在对应状态下。**
  - 现象：1024px 宽时点不中 Unblur。
  - 原因：`@media (max-width: 1100px)` 里的 `.ws-panel { grid-column: 1 / -1 }` 本来只给「完成」状态用，结果连「准备」状态一起改了，固定高度下画布和卡片重叠。
  - 做法：写成 `.ws-done .ws-panel`。
  - 守护：browser-check「ready: photo and controls side by side」。

### 在本机复现 CI

本机复现不了 CI 失败时，用 Docker 限制 CPU 跑同一套检查：

```bash
git add -A && S=$(git stash create) && git archive ${S:-HEAD} -o /tmp/repo.tar && git reset -q
docker run --rm --cpus=2 --memory=7g --shm-size=1g -v /tmp/repo.tar:/repo.tar:ro \
  mcr.microsoft.com/playwright:v1.58.2-noble bash -c '
  mkdir /w && cd /w && tar xf /repo.tar &&
  sed -i "s/\"preview\", \"--port\"/\"preview\", \"--host\", \"127.0.0.1\", \"--port\"/" apps/web/scripts/browser-check.ts &&
  corepack enable && corepack prepare pnpm@10.30.3 --activate && pnpm install --frozen-lockfile &&
  pnpm --filter @vzc/web browser-check'
```

- `--cpus=2` 对应 GitHub runner；用 `--cpus=1` 可以把问题放大。
- 容器里的 Node 会把 `localhost` 解析成 IPv4，而 `astro preview` 只监听 IPv6，所以要用 sed 加上 `--host 127.0.0.1`。这一处只在容器里改，不进仓库。
- Playwright 的版本要和 `apps/web` 里的一致。
- 遗留问题：GitHub runner 上第一次打开示例图偶尔停在「ready」之前，Docker 里复现不了。`result()` 会重试一次，并在日志里打出 `sample flow retried`。如果出现频率上升，就继续查。

## 二、Lighthouse 和 LCP

- **全屏背景图和模糊图不会成为 LCP。**
  - 原因：Chrome 会排除铺满视口的图片，以及信息量太低（低熵）的图片。首屏照片是模糊原图，两条都中，所以 LCP 落在别的元素上。
  - 推论：LCP 一定是首屏文字，要保证这些文字第一帧就画出来。
- **淡入的文字不算 LCP。**
  - 原因：opacity 从 0 开始的文字，等它显示出来也不会被记为 LCP。
  - 做法：首屏的 H1 和副标题只做上浮动画（`hero-lift`，只用 transform），opacity 一开始就是 1；小标签、按钮、信任标签照旧淡入。
  - 守护：`apps/web/src/styles/tool.test.ts`。
- **晚出现的大块文字会抢走 LCP。**
  - 现象：CI 上首页 LCP 5.1s，性能分 80。
  - 原因：Cookie 横幅要等 `/v1/me` 返回才显示，在手机上面积还比首屏副标题大。
  - 做法：缩短横幅文案（`packages/i18n` 的 `cookie.text`，旁边有注释）。
  - 守护：`scripts/lighthouse.ts` 会打印 LCP 元素；如果 LCP 元素是 cookie 横幅，直接判失败。
- **首屏用到的字体要预加载。**
  - 现象：LCP 在 1.9s 和 2.9s 之间跳。
  - 原因：文字先用后备字体画一次，Web 字体到了再画一次，LCP 记的是后一次。
  - 做法：`BaseLayout.astro` 预加载 Inter 400 和 Bricolage 800 两个 woff2。用 `?url` 导入 fontsource 的文件，和 CSS 引用的是同一个带 hash 的文件。
- **首屏就在视口里的 React/Preact 岛，别用 `client:visible` / `client:idle`。**
  - 现象：`/heic-to-jpg`（预览构建）LCP 2.57s，没有工具时 1.95s；LCP 元素是第一个区块的 H2。
  - 原因：这两个指令在首次绘制前就开始下载岛的脚本，Lighthouse 把这些请求算进 FCP / LCP 的依赖。
  - 做法：用自定义指令 `client:after-load`（`apps/web/src/directives/`），页面 load 后再等 400ms 才水合；LCP 回到 2.1s。浏览器检查里要等岛水合完（`astro-island[ssr]` 消失）再选文件。
  - 守护：`scripts/lighthouse.ts` 在预览构建上也测 `/heic-to-jpg`。
  - 本机 Lighthouse 在机器负载高时会在 1.9s 和 2.8s 之间跳，先看 `uptime` 再下结论。
- **Lighthouse 分数有波动，要多跑几次再下结论**（脚本每页跑三次取中位数）。本机比 CI 快很多：本机 97 分，CI 上可能只有 80。看 CI 日志里的 LCP 元素，比看分数更能找到原因。

## 三、测试写法

- **jsdom 里 `import.meta.url` 不是 `file:` 地址。** 测试读文件要用 `join(import.meta.dirname, …)`。
- **`page.evaluate` 的回调里不要定义具名函数。** tsx 会注入 `__name(...)`，浏览器里没有这个函数，会报 `__name is not defined`。改用匿名函数，或者 `.map(...)`。
- **浏览器检查要读浏览器实际算出的值，不要读 CSS 变量。** 对比线的检查一开始读 `--cx-img`，旧代码也能通过；改成读 `getComputedStyle(img).clipPath` 才真正测到效果。
- **新检查要先看它在旧代码上失败。** 做法是临时把旧版本的样式或组件 `git checkout <基线> -- <路径>`，跑一次，确认失败后再恢复。
- **用脚本批量替换代码时，先断言匹配串非空、而且只出现一次。** 有一次截取的子串是空字符串，`replace("", …)` 在每个字符之间都插入了内容，把整个文件写坏了。
- **计时测试不要写固定毫秒上限。** 编辑器的 replace 测试单独跑约 100ms，`pnpm test` 所有包同时跑时变成 0.8–1 秒，400ms 的上限连续失败。改用 `apps/web/src/test/timing.ts` 的 `relativeCost`：取 3 次里最快的一次，再除以同一张图上一次简单遍历的时间。满负载下比值几乎不变（replace 5.8–6.7，adjust 约 0.5），上限留约 3 倍。

## 四、模型和素材

- **文字模式会改数字。** 首屏素材里，收据那张图被 4K 路由改了金额（11.80→11.00、2.60→3.40）和日期。这类结果不能当宣传素材，页面上「务必核对数字」的提示必须保留。见 `apps/web/src/assets/samples/README.md`。
- **首屏照片的生成流程**：
  1. `eval/scripts/make_hero.py` 从 picsum 取 2560×1440 的 Unsplash 原图，加上退化；
  2. `node eval/src/hero.ts --yes` 用正式的 4K 路由和 catalog 里的提示词处理（预算上限 $1，5 张花了 $0.35）；
  3. 结果裁成 16:9 并缩放到 2560 宽，放进 `apps/web/src/assets/samples/hero-*.jpg`；
  4. 在 `samples.ts` 的 `HERO_PHOTOS` 里登记 `focus` 和 `hero`。
- **4K 路由的原始输出约 15–28MB 一张，不进仓库**（`.gitignore` 已排除 `eval/results/hero/*.png`）。
- **jSquash 在 Astro / Vite / Cloudflare 静态资源下可用**（本地工具计划 Task 1 探针，2026-10-13）。正式构建和开发服务器上探针都返回 `{"ok":true,"sizes":{"jpeg":342,"webp":102,"avif":492,"png":99,"resized":32}}`。
  - 导入路径带 `.js`：`@jsquash/jpeg/encode.js`、`@jsquash/webp/encode.js`、`@jsquash/avif/encode.js`、`@jsquash/resize/index.js`；PNG 用单线程的 `@jsquash/oxipng/codec/pkg/squoosh_oxipng.js`，先 `await m.default()` 再 `optimise_raw()`。多线程版需要 COOP/COEP，站点不发这两个头。
  - Worker 里有动态导入，必须在 `astro.config.ts` 设 `vite.worker.format: "es"`；默认的 iife 格式会在构建时报 Rollup 多 chunk 输出错误（已确认，是必需的回退）。
  - 开发服务器：**需要** `vite.optimizeDeps.exclude`（五个 `@jsquash/*` 包）。不加时 wasm 请求返回 HTML，报 `expected magic word 00 61 73 6d, found 3c 21 44 4f`。正式构建不受影响。已写进 `astro.config.ts`。
  - Node 测试里用 `src/lib/local/node-codecs.ts` 先把编译好的 wasm 交给各编码器的 `init`；webp 用 `webp_enc_simd.wasm`。与计划不同的一处：`oxipng.initSync` 直接收 `WebAssembly.Module`，不是 `{ module }`。
  - 构建产物（`dist/_astro/`，size-limit 用，文件名带哈希）：`mozjpeg_enc-*.wasm`、`webp_enc_simd-*.{js,wasm}`、`webp_enc-*.{js,wasm}`（非 SIMD 回退）、`avif_enc-*.{js,wasm}`、`avif_enc_mt-*.{js,wasm}`、`avif_enc_mt.worker-*.js`（多线程 AVIF，用不到）、`squoosh_oxipng-*.js` + `squoosh_oxipng_bg-*.wasm`、`squoosh_resize_bg-*.wasm`、`jsquash_magic_kernel_bg-*.wasm`、`squooshhqx_bg-*.wasm`，另有三个 `encode-*.js`（jpeg / webp / avif 的包装）。
- **老年双人帧不能靠人脸打分判性别。**
  - 现象：圣诞 R1（`eval/results/xr1`）打分报告选中帧里 22 张「性别画反」，逐张对照参考照片后全部是误报，性别和角色（谁站着挂挂饰、谁坐在椅子里）都对。
  - 原因：老年化后的小脸、侧脸和年轻参考照片的相似度只有 0.12–0.3，一对一配角色基本是随机的，性别是从配错的那张脸上读的。
  - 做法：老年双人帧（wide / tree / embrace）的验收以人工看图为准，打分器的性别项只作提示；回忆帧（年轻、正脸，相似度 0.7–0.8）仍可信。对照图：`eval/results/xr1/xr1-flips.jpg`、`xr1-twoshots.jpg`。
- **镜头之间的叠化（xfade）。**
  - 做法：被切走的镜头末尾定格 `dissolveSec` 秒（`tpad=stop_mode=clone`），叠化起点放在分镜切点上，每个镜头仍然准点开始、总长不变，也不用向模型多买秒数。白闪那一刀保持硬切（用 `concat=n=2`）。
  - 坑：`concat` 输出的时间基是 1/1000000，`xfade` 要求两路一致，否则报 `First input link main timebase … do not match`。每一路和每个 concat 之后都 `settb=1/24`。单元测试只比字符串，抓不到这种错，要用真实 ffmpeg 渲染一次（9 段与分镜等长的 testsrc2 片段）。
  - 叠化需要的定格不能省：片段比「秒数 + 叠化」短时，`xfade` 会把下一个镜头整个吞掉（即梦预览里拥抱镜头消失过）。
- **即梦 Seedance 的片段是可变帧率**（标称 60 fps，4 秒 97 帧）。直接 `fps=24` 会重复和丢帧，看着一顿一顿；先 `setpts=N/(24*TB)` 规整成恒定 24 fps。KIE 的 Kling 输出本来就是恒定 24 fps。
- **加新故事不改生成流程。**
  - 现象：丧尸片的 A/B/C 关键帧和 5 个镜头写死在 `graph.ts`、运行器和合成里，第二个故事塞不进去。
  - 做法：故事是 `packages/catalog/src/stories/` 里的一份数据（关键帧引用、分镜、叠字、字幕卡、积分）。生成步骤和依赖由关键帧引用自动排出；场景共用的成片用 `{ clip }`，不发起模型调用。
  - 守护：`packages/catalog/test/stories.test.ts`（丧尸包装与原数据逐项相等、`validateStory`）、`apps/api/test/story-graph.test.ts`（丧尸步骤与依赖不变）。

## 五、邮件和健康检查

- **告警邮件和登录验证码走同一个 `send_email` 绑定。**
  - 推论：告警能收到，就说明发信本身没问题；验证码收不到，多半是被 Gmail 当成钓鱼邮件（新域名，内容是验证码加链接）。
  - 做法：域名要有 DMARC（目前是 `p=none`，只监控）。
- **健康检查依赖 R2 里的 `samples/health.jpg`。** 缺这个文件时，每小时都会告警「is missing from R2」。两个环境都要上传（用的是 `portrait-before.jpg`，合成图，不是真实照片）。

## 六、外部账号和密钥操作

- **密钥只走管道，不进输出。**
  - 做法：从页面读出值后，直接 `printf … | wrangler secret put` 或 `gh secret set`。
  - 屏蔽规则：读页面文字的脚本要屏蔽 **16 个字符以上**的串。有一次屏蔽阈值是 24，一个 22 位的 GA4 密钥漏了出来，只好作废重建。
  - 一旦显示过，就当作泄露：轮换，再删掉旧的。
- **两种 wrangler 凭证的权限不同。**
  - `~/.vzc-secrets/cloudflare-setup.env` 里的 setup token 能改 DNS，不能写 Worker secret。
  - 写 secret 要用本机的 wrangler OAuth 登录：命令前加 `env -u CLOUDFLARE_API_TOKEN`。
- **staging 冒烟 key 的本机副本**在 `~/.vzc-secrets/smoke.env`。轮换时要同时更新 Worker secret `SMOKE_KEY` 和 GitHub secret `STAGING_SMOKE_KEY`。两边不一致，CI 冒烟就会失败。
- **动手前先确认账号属于哪个项目。** 浏览器里已登录的 Waffo 是 video2mp4 的商户（有真实订单）。登录任何收款或广告后台之后，第一件事是看清商户名和店铺名，不对就停下。
- **Waffo 的设置流程**（测试模式已做过一遍，正式模式照做）：
  1. 在**无痕窗口**里用 `hello@videozombiecouple.com` 邮件登录。普通窗口里已登录的是 video2mp4 的商户，不要退出它；登录链接会转发到 Gmail。
  2. 在「API 与开发」里建 API 密钥（选对测试或正式环境，不勾选「允许再次下载私钥」）。页面上显示的私钥是一整段 base64，没有 PEM 头，要自己补上 `-----BEGIN PRIVATE KEY-----`，存成 `~/.vzc-secrets/waffo-<test|prod>.pem`（权限 600），再写入 Worker secret `WAFFO_PRIVATE_KEY`。
  3. 把商户 ID 和店铺 ID 写进 `~/.vzc-secrets/waffo-ids.txt`（正式模式写 `waffo-ids-prod.txt`），然后运行 `node scripts/waffo-setup.ts <test|prod> --yes`。脚本按 catalog 建 9 个商品（每个都带 `productKey` 元数据）和 webhook，可以重复运行，最后打印要填进 wrangler 配置的三个变量。
- **浏览器自动化**用 AppleScript 在真实 Chrome 里执行 JS，详细做法见 Obsidian「08-和AI代理协作」。常见问题：
  - Google 系后台（GSC、GA4、Cloud Console）不认脚本发出的点击，要用 `cliclick` 真点。按钮太靠窗口底部时点不中，改为先聚焦再按回车。
  - Angular 表单不认脚本赋值，而直接打字又会经过中文输入法，所以用粘贴：先保存剪贴板，`pbcopy`，⌘A ⌘V，最后恢复剪贴板。
  - GA4 的安装代码在跨域 iframe 里，读不到。衡量 ID 去数据流详情页读，那里是普通文字。
  - Sentry 和 Cloudflare 的 API 可以在已登录的页面里用 XHR 调（Sentry 的 CSRF cookie 是 `sentry-sc`）。Cloudflare 建 token 的页面支持 `?permissionGroupKeys=[…]&name=&accountId=` 预填权限。
- **Google OAuth 应用新建后是「测试」状态**，只有测试用户能登录。先在品牌页填好首页、隐私政策和服务条款链接，再「发布应用」。只用 email 和 profile 范围，不需要 Google 审核。

## 七、落地页交互

- **首屏不跟随鼠标变化。**
  - 现象：测试环境里，鼠标经过首屏照片，慢对焦循环就停下，照片按鼠标位置切成前后对比（原「悬停对比」）。
  - 原因：首屏照片铺满背景，用户只是去点上传按钮或往下滚，鼠标也会经过照片，所以对比几乎都是误触发，打断了用户读标题、找按钮。
  - 做法：首屏只自动循环，不监听指针。前后对比只在用户主动操作的地方提供（效果画廊、工作台滑块）。
  - 守护：`apps/web/src/lib/hero.test.ts`「ignores the pointer」，以及 browser-check「the hero ignores the pointer」。

## 上线 VideoZombieCouple（2026-10-14）
- 新 zone 卡在 initializing（activation_check 报 81163）：要把 dashboard 的接入向导走完（选 Free 计划 → DNS 记录页 Continue to activation → 确认），状态才变 pending，再触发 activation_check。
- wrangler 偶发 `fetch failed`：步骤都是幂等的，`scripts/deploy.sh` 对每条 wrangler 命令重试 3 次。
- 部署 token 没有重定向规则权限（rulesets 报 Authentication error）；www→apex 的 301 规则是用 dashboard 会话建的。改规则要么在 dashboard 操作，要么给 token 加 "Dynamic URL Redirects"。
- 上传归属于 `vid` cookie：smoke 脚本必须像浏览器一样带上 API 下发的 `vid`，否则建故事返回 403 FORBIDDEN。
- Email Sending 在账号级页面接入（Email Service → Email Sending → Onboard Domain），zone 级页面在新 zone 上是空白的。每日发送配额 200 封，和同账号的其他站共用。

## Cloudflare 容器与账单（2026-10-15）
- **调用容器拿到的每个 Response 都要读完**（`json()` / `text()`）或 `body.cancel()`。`@cloudflare/containers` 把 body 没读完的请求算作「进行中」，有进行中的请求就永远不执行 `sleepAfter`，实例一直开到下次部署。`composerFor` 原来遇到非 2xx 直接抛异常不读 body，已修，`test/composer-shards.test.ts` 断言每个 Response 的 `bodyUsed`。同账号的 video2mp4 就因为这个 3+3 个实例常开 13 天，见 Obsidian「20-Cloudflare费用与容器控制」。
- 部署会重启实例，部署后实例为 0 不能证明修好：要等真实请求把它叫醒，再看 10 分钟（`sleepAfter`）后能不能自己回到 0（`wrangler containers list`）。
- 这个 Cloudflare 账号的账单和 video2mp4（`v2m-*`）混在一起，看 Billable usage 前先按应用分清是谁在花钱。
- R2 生命周期不跟仓库走：线上规则曾经是 15 天，而页面承诺 30 天。现在 `deploy.sh` 每次部署都应用 `infra/r2-lifecycle.json`。

## 上线「50 Christmases」（2026-10-16）
- 生产从 `feat/christmas-content` 用 `scripts/deploy.sh production` 手动部署；`feat/model-eval` 快进到同一提交并推送，`main` 未使用。
- **首页主打故事只在构建时切换**（`FEATURED` in `packages/catalog/src/pages.ts`）：2026-11-01（切到圣诞）和 2026-12-27（切回）必须各重新部署一次生产。
- Stripe 新商品先要有上线的场景：`stripe-setup.ts` 只为 `SALE_PRODUCTS` 建商品，所以先在本地把场景 `live` 打开，再跑 `stripe-setup test|live --yes`，把打印的 `STRIPE_PRICES` 贴进对应 wrangler 配置。live 前先在 SunBrowser 确认商户是 VideoZombieCouple。
- 测试站的新付费用户每天只能花 50 积分（现已改为 100），R2 跑第 3 条时被 `DAILY_LIMIT` 拦下：测试账号要么设 `users.daily_credit_cap`，要么分天跑。
- 同一浏览器只记住一个故事（`vzc-story`）：带 `preset.story` 的页面只恢复同类故事，否则做过丧尸片的人打开圣诞页会看到丧尸片（最终审查发现）。
- 上线前没有在测试站用测试卡完整买过一单 `christmas1`（所有者决定跳过）；生产首单要人工确认订单、积分和成片。
- Search Console：域名资源提交站点地图要填完整网址（`https://videozombiecouple.com/sitemap-index.xml`），只填路径会报「站点地图地址无效」。「请求编入索引」按钮不认脚本点击，用 `cliclick c:x,y` 做真实点击（先把 Chrome 切到前台；坐标 = window.screenX + 元素中心，y 再加 outerHeight − innerHeight）。2026-10-16 已为 `/ai-christmas-video` 和 `/` 请求编入索引。
