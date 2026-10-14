# 成本护栏：后台操作和演练

设计：`docs/superpowers/specs/2026-10-14-cost-guardrails-design.md`。恢复部署前，下面每一项都要做完，并在第 5 节打勾、写日期。

## 1. kie 子密钥每日额度
- 登录 kie.ai 前，先确认当前账号属于 VideoZombieCouple（CLAUDE.md 规则）。
- API Keys 页面：生产密钥 `vzc-production` 的每日额度设为 $60（等于 catalog 的 `KIE_KEY_DAILY_CAP_USD`）。staging 密钥 `vzc` 照旧。
- 以后调高额度时，同步改 catalog 里的 `KIE_KEY_DAILY_CAP_USD`。

## 2. Cloudflare 账单提醒
- Dashboard → Manage Account → Billing → Billable Usage → Budget alerts。
- 新建三条：$10、$25、$50，收件人用告警邮箱。
- 提醒大约晚一天才到；实时的保护靠代码里的预算和暂停。

## 3. Cloudflare WAF 限速规则（Free 版一条）
- videozombiecouple.com → Security → WAF → Rate limiting rules → Create rule。
- 条件：Hostname 等于 `api.videozombiecouple.com`，并且 URI Path 以 `/v1/` 开头。
- 同一 IP 10 秒内超过 100 次就 Block，持续 10 秒。
- 上线后一周内，在 Security → Events 里查看有没有误伤（正常用户每分钟最多几十个请求）。

## 4. staging 演练
1. 在管理后台 `Today's paid limit (USD)` 填 0.01，然后提交一个付费任务。确认：
   - 5 分钟内出现「Paid jobs paused」告警；
   - 下一个付费任务返回 `PAUSED`；
   - 免费任务照常。
2. 在后台恢复付费任务，确认能继续扣积分。
3. 在 kie 后台把 staging 密钥的额度临时调到很低，跑一次任务。确认：
   - 出现 kie 额度告警，全站返回 `PAUSED`；
   - 把额度调回来以后，到 kie 重置密钥额度的时间自动恢复，也可以在后台手动取消暂停。
   - 记下 kie 实际重置密钥额度的时间（UTC），把 catalog 的 `KIE_KEY_RESET_UTC_HOUR` 设成这个小时（现在假设是 0，即 UTC 零点）。
4. 给自己的测试账号设每日上限 1。先用完当天的免费额度（免费任务不计入这个上限），再提交 Standard 任务：第一个照常扣积分，第二个返回 `DAILY_LIMIT`。不要用 Pro / 4K 演练，它们单价超过 1，会直接被拒。演练后清空这个上限。

## 5. 核对清单
- [ ] kie 生产密钥额度 $60 —— 日期：
- [ ] Cloudflare 账单提醒三档 —— 日期：
- [ ] WAF 限速规则 —— 日期：
- [ ] staging 演练 1–4 全部通过 —— 日期：
