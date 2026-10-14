# 上线清单（P0）

设计 11.3 的上线门槛，加上代码之外、需要你本人在各个账号里完成的步骤。每项写了「做完的判断标准」。全部打勾后，在 GitHub Actions 里手动运行 deploy，完成第一次正式部署。

账号和收款都要和 video2mp4 完全隔离：本清单里的每个账号（Cloudflare、GitHub 环境、Sentry、Telegram、Waffo、Google）都用 VideoZombieCouple 自己的。证件号、银行卡等敏感信息不要写进这个仓库。

## 账号与 ID 一览

只记公开的 ID，密钥不写进来（密钥在 wrangler secret、GitHub secret 和 `~/.vzc-secrets/`）。

| 服务 | 账号 / 资源 | ID 或位置 |
|---|---|---|
| Cloudflare | liufeng124.lwx 的账号（和 video2mp4 同账号，资源都以 `vzc` 开头） | 账号 `4b2e7a7b095a410bd4bbc63a23698cdf`，zone `4f7169966ede19b5f4861550fe98f695` |
| Cloudflare Access | Zero Trust 团队 | `long-forest-073f.cloudflareaccess.com` |
| Google Search Console | 域名资源 | `sc-domain:videozombiecouple.com`（DNS 验证） |
| Google Analytics 4 | 账号 VideoZombieCouple / 媒体资源 videozombiecouple.com | 衡量 ID `G-PS40BWYD3Z`（账号 `a411687143`，媒体资源 `p558681018`） |
| Microsoft Clarity | 项目 VideoZombieCouple | `ywwxnphmaz` |
| Sentry | 组织 `vzc`，项目 `api`、`web` | DSN 在 secret / GitHub variable |
| Google Cloud（登录） | 项目 vzc | 项目 ID `winter-monolith-511504-q1`；OAuth 客户端 `538311406802-aupo4qgkebrj0iq20qugi6rfumgtv0of.apps.googleusercontent.com`（已发布为正式版） |
| KIE | 密钥 `vzc`（staging）、`vzc-production` | 只在 secret 里；正式环境密钥的消费上限由你在 kie.ai 设置 |
| Waffo | VideoZombieCouple 自己的商户（`hello@videozombiecouple.com` 邮件登录，和 video2mp4 的商户分开），店铺 VideoZombieCouple | 测试模式的商户 ID、店铺 ID、商品 ID 在 `apps/api/wrangler.jsonc`；私钥在 `~/.vzc-secrets/waffo-test.pem` 和 staging secret。正式模式要先提交商业资质审核（KYB），之后用同一个脚本建正式商品 |
| Telegram | 未建（可选，邮件告警已能用） | — |

## 一、设计 11.3 的上线门槛

- [ ] **1. 真实照片评测**：NSFW 误判率和补边对齐精度合格；诊断规则和保真检查阈值已在真实照片上校准，误触发免费重做 < 10%。
  - 判断：`eval/` 的评测报告里这三项都有数字且达标；真实照片只在 `eval/data/real/`，已去掉 EXIF / GPS。
- [ ] **2. 第二供应商已决定**：开发阶段只接了 kie，备用都是 kie 的其他模型。上线前决定是否接入 fal 等第二供应商。
  - 判断：在设计文档里写下决定；如果接入，适配器有测试，路由经过评测。
- [ ] **3. Waffo 商户审核通过**（不通过则切 Creem）。
  - 判断：Waffo 后台为正式模式，拿到 `WAFFO_MERCHANT_ID`、`WAFFO_STORE_ID`、各产品 ID（填进 `apps/api/wrangler.production.jsonc` 的 vars），以及 `WAFFO_PRIVATE_KEY` 和 webhook 公钥（secret）。
- [ ] **4. 法律页上线；DMCA 登记加别名；怀俄明年审完成**（截止 2026-12-01）。
  - 判断：Terms、Privacy、Refund、DMCA 页在正式构建里状态为 live；DMCA 登记里有 `dmca@videozombiecouple.com`；年审回执已存档（存在仓库之外）。
- [ ] **5. 正式环境密钥齐全；kie 余额够 30 天**。
  - 判断：`scripts/launch-secrets.sh production` 输出 `All secrets set`；kie 余额 ≥ 30 × 预计日均成本。
- [ ] **6. 正式环境用测试卡走通购买和退款**。
  - 判断：一笔积分包和一个订阅在测试卡下购买成功、积分到账，退款后积分被扣回，`/admin/users` 里流水正确。
- [ ] **7. GSC 资源验证、sitemap 提交；`hello@`、`dmca@` 邮箱可用；videozombiecouple.com 已注册**。
  - 2026-10-13：GSC 域名资源 `sc-domain:videozombiecouple.com` 已通过 DNS 验证；sitemap 等正式环境部署后再提交。
  - 判断：GSC 里 `https://videozombiecouple.com/sitemap-index.xml` 状态为「成功」；给两个邮箱各发一封测试信能收到。
- [ ] **8. 成本护栏**：成本护栏 runbook（docs/runbooks/cost-guardrails.md）第 5 节全部打勾，才能恢复部署。
  - 判断：第 5 节四项都写了日期；staging 演练 1–4 的结果在 runbook 里能对上。

## 二、Cloudflare

- [x] 本机 `wrangler login`（VideoZombieCouple 的 Cloudflare 账号），然后运行：（2026-10-11 完成，两个环境的 id 已填）

  ```bash
  scripts/setup-cloudflare.sh staging
  scripts/setup-cloudflare.sh production
  ```

  - 判断：脚本打印出 D1 `database_id` 和 KV id；把它们和 `R2_ACCOUNT_ID`（账号 ID，`wrangler whoami` 能看到）填进 `apps/api/wrangler.jsonc` 和 `wrangler.production.jsonc`；两个 R2 桶都有 CORS 和生命周期规则；`vzc-backups` 桶存在。
- [x] 为 R2 S3 接口建 API token（只读写这两个桶），把 key 设成 secret `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。（token `vzc-r2`，只限两个桶）
- [x] **Cloudflare Access**：Zero Trust 里建两个自托管应用，分别保护 `api.videozombiecouple.com/admin*` 和 `api-staging.videozombiecouple.com/admin*`，策略只放行你的邮箱。（team 域名 long-forest-073f）
  - 把团队域名（`<team>.cloudflareaccess.com`）、应用的 AUD 和管理员邮箱分别设成 secret `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ADMIN_EMAILS`。
  - 判断：打开 `https://api.videozombiecouple.com/admin` 先跳 Access 登录，登录后看到「Switches」页；没设这三个 secret 时是 404。
- [x] 规则：`www.videozombiecouple.com` 301 到 `https://videozombiecouple.com`（保留路径和查询串）。
- [x] Turnstile：两个站点（staging 和正式），拿到 site key（填 GitHub vars）和 secret（`TURNSTILE_SECRET`）。
- [ ] Email Routing / `send_email`：验证 `no-reply@videozombiecouple.com` 可发信；`hello@`、`dmca@` 转发到你的邮箱。
  - 2026-10-13：转发已开；发信接口返回成功，但验证码邮件没收到，已补 DMARC（`p=none`），待复查。
- [x] 把健康检查用图 `samples/health.jpg` 和首页示例图上传到两个环境的 R2：（2026-10-13 两个环境都已上传，用的是合成示例图 `portrait-before.jpg`）

  ```bash
  cd apps/api
  pnpm exec wrangler r2 object put vzc-staging/samples/health.jpg --file <一张普通模糊照片> --remote
  pnpm exec wrangler r2 object put vzc/samples/health.jpg --file <同一张> --remote
  ```

  - 判断：第一次每小时健康检查后没有 `Health check failed` 告警。

## 三、密钥

- [ ] 两个环境都运行 `scripts/launch-secrets.sh staging` 和 `scripts/launch-secrets.sh production`，按输出把缺的 secret 用 `wrangler secret put <NAME> -c <配置>` 补上。
  - 测试环境的 `KIE_API_KEY` 用设了消费上限的子 Key；Waffo 用 test 模式的 Key。
  - 测试环境另外需要 `SMOKE_KEY`（32 个以上随机字符，例如 `openssl rand -hex 24`），同一个值设成 GitHub secret `STAGING_SMOKE_KEY`。正式环境不设。
  - 判断：两条命令都输出 `All secrets set`；正式环境如果误设了 `SMOKE_KEY`，脚本会要求删除。
- [x] 每周 Cloudflare 用量报告（决定以后要不要迁到自己的服务器）：在 Cloudflare 建一个**只读** API token，权限为 Account Analytics Read、Workers Scripts Read、D1 Read，设成正式环境的 secret `CF_ANALYTICS_TOKEN`。每周一的报告只统计 vzc 自己的 Worker、Durable Objects、D1 和 R2 桶（两个环境合计），按标价折算成每月费用；超过 $30 会单独告警。（2026-10-13 token `vzc-usage-report` 已建并设为 secret）
  - 判断：第一个周一 04:00 UTC 后，告警群里收到 `Cloudflare usage, last 7 days`。
- [x] KIE 密钥只在 `~/.vzc-secrets/eval.env` 和 wrangler secret 里，不进仓库、不进日志。

## 四、GitHub

- [x] 仓库 Settings → Environments：`staging`、`production`、`backups` 已建好，都只允许从 `main` 部署。仓库是私有的，免费计划没有环境审批人，所以人工批准就是**手动运行**：推送到 `main` 只部署测试环境；在 Actions → deploy → Run workflow 手动运行时，才会在测试环境再次通过冒烟后部署正式环境。如果以后升级 GitHub Pro，可以再给 `production` 加 Required reviewers。
- [x] Secrets：`CLOUDFLARE_API_TOKEN`（权限：Workers 脚本、D1、R2、KV、Workers 路由编辑，只限 VideoZombieCouple 账号）；`STAGING_SMOKE_KEY`。（`STAGING_SMOKE_KEY` 2026-10-13 轮换过，本机副本在 `~/.vzc-secrets/smoke.env`）
- [x] Variables：`CLOUDFLARE_ACCOUNT_ID`、`STAGING_TURNSTILE_SITE_KEY`、`PRODUCTION_TURNSTILE_SITE_KEY`、`SENTRY_DSN_WEB`、`GA4_ID`、`CLARITY_ID`、`ADS_ENABLED`（上线时留空或 `false`）。（2026-10-13：GA4 `G-PS40BWYD3Z`、Clarity `ywwxnphmaz`、Sentry web DSN 已设）
- [ ] 判断：在 Actions 里手动触发 `deploy`，staging 部署和冒烟（跑一个真实标准档任务，约 $0.016）通过，production 被跳过（只有手动运行才部署正式环境）。

## 五、告警和错误监控

- [ ] Telegram：建机器人（BotFather）和一个只有你的群，把 token 和群 ID 设成 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`；`ALERT_EMAIL` 设成你的邮箱。
  - 判断：让 staging 的 kie 子 Key 暂时失效，5 分钟内收到 `is failing` 告警，恢复后收到 `Resolved`。
- [ ] **Sentry**：建两个项目（api、web）。api 的 DSN 设成 secret `SENTRY_DSN`；web 的 DSN 设成 GitHub variable `SENTRY_DSN_WEB`（DSN 是公开值）。
  - 2026-10-13：组织 `vzc`、项目 `api`（DSN 已设两个环境的 secret）和 `web`（DSN 已设 GitHub variable）已建；告警规则和上报测试还没做。
  - 告警规则：同一问题 5 分钟内 > 50 次 → 邮件或 Telegram（设计 8.3）。
  - 判断：在 staging 浏览器控制台执行 `setTimeout(() => { throw new Error("sentry test") })`，web 项目里出现这条错误，且上报内容里没有 cookie 和网址查询串。

## 六、第一次正式部署之后

- [ ] 在测试环境用测试卡完整走一遍：游客处理 → 额度用完 → 付费卡片 → 邮箱链接登录 → 回跳确认 → 购买 → 积分到账 → 处理 → 退款 → 积分扣回。
- [ ] 正式环境冒烟通过；IndexNow 步骤输出 `submitted N urls`。
- [ ] 第一次每周任务（周一 05:00 UTC）后，`vzc-backups/d1/` 里有当周的导出。
- [ ] 一周内在测试环境演练一次 [D1 数据恢复](runbooks/d1-restore.md)。

## 应急手册

- [kie 整体故障](runbooks/kie-outage.md)
- [某个模型被下架或改价](runbooks/model-removed-or-repriced.md)
- [支付 Webhook 持续失败](runbooks/payment-webhooks-failing.md)
- [成本暴涨或被刷](runbooks/cost-spike-or-abuse.md)
- [成本护栏后台操作和演练](runbooks/cost-guardrails.md)
- [D1 数据恢复](runbooks/d1-restore.md)
