# 上线清单

VideoZombieCouple 已于 2026-10-14 上线（正式站 videozombiecouple.com，测试站 staging.videozombiecouple.com）。本页记录各账号的真实 ID、已完成的步骤，以及还需要你本人处理的事。

账号和收款都要和 UnblurPix、video2mp4 完全隔离。证件号、银行卡、私钥等敏感信息不写进这个仓库（仓库是公开的）。

## 账号与 ID 一览

只记公开的 ID；密钥在 wrangler secret、GitHub secret 和本机 `~/.vzc-secrets/`。

| 服务 | 账号 / 资源 | ID 或位置 |
|---|---|---|
| Cloudflare | liufeng124.lwx 的账号（和 video2mp4 同账号，资源都以 `vzc` 开头） | 账号 `4b2e7a7b095a410bd4bbc63a23698cdf`，zone `d6cfe19ae58b8c76ed158c4acdce14b2`（NS kobe / peaches） |
| Cloudflare 部署 token | `vzc-deploy (VideoZombieCouple)` | 本机 `~/.vzc-secrets/cloudflare.env`，GitHub secret `CLOUDFLARE_API_TOKEN`；没有重定向规则权限 |
| D1 / KV / R2 | staging：D1 `37004cec-…`，KV `4524be5b…`，桶 `vzc-staging`；正式：D1 `f15134d9-…`，KV `6dbebd4f…`，桶 `vzc`；备份桶 `vzc-backups` | 见 `apps/api/wrangler*.jsonc` |
| Turnstile | 小组件 videozombiecouple（不可见模式，两个环境共用） | site key `0x4AAAAAAFXFU0AYtg74xyTA` |
| 邮件 | Email Sending 已接入（SPF / DKIM / DMARC 已配）；Email Routing：`hello@`、`dmca@` 转发到 liufeng124.lwx@gmail.com | 每日发送配额 200 封，与 video2mp4 共用；2026-10-14 已提交提额申请（2,000 封/天） |
| 重定向 | `www` 301 到主域名（保留路径和查询串） | 用 dashboard 会话建的单条重定向规则 |
| Google Search Console | 网域资源 `sc-domain:videozombiecouple.com` | sitemap 已提交 |
| Bing Webmaster | `https://videozombiecouple.com/` | CNAME 验证记录 `75ca7fceeb1c0fad6e930aaa5b604a05` → `verify.bing.com`（不要删）；sitemap 已提交；IndexNow 已推送 |
| Google Cloud（登录） | 项目 `videozombiecouple`（liufeng124.lwx） | OAuth 客户端 `876510837060-62rgai18m99a6ofgs4rvricmd19pc42u.apps.googleusercontent.com`，已发布为正式版 |
| Google Analytics 4 | 账号 VideoZombieCouple / 媒体资源 videozombiecouple.com | 衡量 ID `G-PHDSR4556T`；Measurement Protocol 密钥在 secret；只统计正式环境 |
| Microsoft Clarity | 项目 VideoZombieCouple（与 UnblurPix 项目同一登录） | `yxv3ilksct`；故事工具整块屏蔽录制 |
| Sentry | 组织 `videozombiecouple`，项目 `api`、`web` | DSN 在 secret / GitHub variable；峰值告警规则还没建（API 返回 404，请在后台建：同一问题 5 分钟 > 50 次 → 邮件） |
| KIE | 正式和测试都用 `~/.vzc-secrets/eval.env` 里的密钥 | 每小时消费上限由你在 kie.ai 调高 |
| SeeAPI | 上传照片 NSFW 检测（`nsfw-filter` / `image-moderation`），密钥在 `~/.vzc-secrets/seeapi.txt` 和 wrangler secret `SEEAPI_API_KEY`（测试站、正式站共用） | 每张约 0.01 credit；用量查 `GET https://api.seeapi.com/v1/usage`。检测故障时重试 2 次后放行并报 Sentry；要改成拦下，设 `MODERATION_FAIL=closed` |
| Stripe | Arrayon 登录下单独新建的账号 **VideoZombieCouple**（`acct_1UQlpkK1NmwsUaE9`，选的是“独立账号”，不和 video2mp4 的 Arrayon 账号共享数据），沙盒 `acct_1UQlqEGZhLcYFqqh`。开了 **Managed Payments**：Stripe 当代收方，负责销售税/VAT、欺诈和争议，每笔另收 3.5%。商品税码 `txcd_10105001`（AI 云服务，个人使用）。登录用 AdsPower（SunBrowser）里固定美国 IP 的配置。 | 沙盒：三个商品、webhook 已建，测试站用测试卡实测付款到账和全额退款扣回积分。正式账号已能收款（2026-10-15），正式站已部署。Waffo 已停用。 |
| GitHub | 仓库 `liufeng124lwx-ux/videozombiecouple`（**公开**） | secrets：`CLOUDFLARE_API_TOKEN`、`STAGING_SMOKE_KEY`、`STAGING_SMOKE_SESSION`；variables：账号 ID、Turnstile、Sentry web DSN、GA4、Clarity、`ADS_ENABLED=false` |

## 已完成

- [x] Cloudflare：zone 激活，D1 / KV / R2 / 备份桶，Workers + Containers（composer）两个环境部署。
- [x] 测试站真实全流程：两张示例照片 → 免费预览 → 付费成片（12 秒、720×1280、有音乐）→ 下载 → 分享链接（`apps/web/scripts/smoke.ts`）。
- [x] 独立代码审查的严重 / 重要问题全部修复（见 `.superpowers/sdd/` 账本）。
- [x] 搜索收录：GSC、Bing、IndexNow、AI 爬虫未被拦截、`llms.txt`。
- [x] Google 登录、GA4、Clarity、Sentry 接入，均为本站独立的账号或项目。
- [x] CI：lint、类型检查、全部单测、composer pytest、故事流程的浏览器 e2e；Lighthouse 只告警（首页 LCP 在模拟慢速 4G 下 2.55–2.7 秒，目标 2.5 秒）。

## 上线门槛（设计 8.3：沿用 UnblurPix 的清单，另加容器健康检查和真实视频冒烟）

- [x] **setup-cloudflare.sh**：两个环境都跑过，D1、KV、R2 和 `vzc-backups` 都在，id 已填进 wrangler 配置。
- [x] **真实照片评测**：用 AI 生成的成人示例照片做过评测（`docs/model-eval.md`）。真实用户照片的误判率要在上线后从运营数据看。
- [x] **第二供应商**：暂不接，备用路由都是 kie 上的其他模型（Veo 3.1 Lite、Seedance 2 Mini）。
- [ ] **Stripe 正式账号**：资料和代表人身份证件已提交（2026-10-15），收款已开通（Payments: Active），正式站已部署，真卡付款 $4.99 已到账（订单 stripe / paid）。**还差**：① 这笔真卡付款在后台退款，确认积分扣回（测试站已用测试卡验证过）；② 「Provide information for an account representative」任务在 2026-11-14 或收款满 $600 前处理，否则暂停提现；③ 把密钥权限收窄到只剩 Checkout Sessions 写权限；④ 打开 Stripe 收据邮件。
- [ ] **法律页**：Terms、Privacy、Refund、DMCA 已上线；DMCA 登记还没加本站别名。
- [ ] **密钥**：`scripts/launch-secrets.sh production` 仍缺 `WAFFO_PRIVATE_KEY`（等正式商户）、`TELEGRAM_*`（可选）、`ACCESS_*` 和 `ADMIN_EMAILS`（不设时管理后台是 404，等于关闭）、`CF_ANALYTICS_TOKEN`（每周用量报告）、R2 S3 key（不需要，文件走 `/files` 代理）。`ALERT_EMAIL` 已设。
- [x] **GSC**：网域资源已验证，sitemap 已提交。
- [ ] **Cloudflare Access**：没建，管理后台保持关闭。需要时在 Zero Trust 建应用，把 `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`、`ADMIN_EMAILS` 设成 secret。
- [x] **Sentry**：组织和项目已建，DSN 已设；峰值告警规则待在后台补建。
- [x] **samples/health.jpg**：两个环境的 R2 都已上传（AI 示例照片）。健康检查每小时一次关键帧、每 6 小时一次镜头，每个环境约 $1.2/天。
- [x] **STAGING_SMOKE_KEY**：已设成测试站 secret 和 GitHub secret；`STAGING_SMOKE_SESSION` 是测试账号 smoke@videozombiecouple.com 的会话。
- [x] **真实视频冒烟**：测试站跑通一条完整故事（`SMOKE_REAL_JOB=1`，约 $0.92）。
- [ ] **成本护栏**：成本护栏 runbook（docs/runbooks/cost-guardrails.md）第 5 节全部打勾，才能恢复部署。WAF 限速规则已建（2026-10-14）；账单提醒用账号已有的两条；kie 额度由你设置；staging 演练还没做。

## 还需要你处理

1. **收款（阻塞）**：已改用 Stripe Managed Payments（Waffo 的禁止清单不允许把两个真人合成到拥抱场景，所以不接 Waffo）。Stripe 的禁止清单没有这类限制，我们的产品属于 Managed Payments 支持的「AI 云服务」类别。正式账号已能收款，剩余事项见上面。
2. **DMCA 登记加别名**：登录 dmca.copyright.gov（Login.gov，需要你的双重验证），对 Arrayon Inc（DMCA-1082308）做 Amend，别名加 `VideoZombieCouple`、`videozombiecouple.com`，联系邮箱加 `dmca@videozombiecouple.com`，Pay.gov 付约 $6。完成后把登记号写进 DMCA 页面。
3. ~~音乐授权~~：2026-10-15 已在 Suno Pro 订阅期内于 suno.com 重新生成三首并替换（记录见 `assets/music/README.md`）。
4. **KIE**：调高正式使用的密钥的每小时消费上限。
5. **怀俄明年审**：2026-12-01 前（见 Obsidian「Arrayon Inc」）。

## 应急手册

- [kie 整体故障](runbooks/kie-outage.md)
- [某个模型被下架或改价](runbooks/model-removed-or-repriced.md)
- [支付 Webhook 持续失败](runbooks/payment-webhooks-failing.md)
- [成本暴涨或被刷](runbooks/cost-spike-or-abuse.md)
- [成本护栏后台操作和演练](runbooks/cost-guardrails.md)
- [D1 数据恢复](runbooks/d1-restore.md)
