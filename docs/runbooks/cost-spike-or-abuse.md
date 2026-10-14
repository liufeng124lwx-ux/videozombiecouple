# 应急手册：成本暴涨或被刷

## 现象

- 告警：
  - `Free tier paused: today's free spend hit the cap`：当日免费档成本到了 $20（`BUDGETS.free.dailyUsd`），免费任务已自动返回 `FREE_TIER_PAUSED`，付费不受影响，UTC 零点自动恢复。
  - `Paid jobs paused: today's paid spend hit the daily line`：当日付费成本到了预算线（7 日均值 × 3，最低 $30，见 `BUDGETS.paid`），付费任务返回 `PAUSED`，只能由管理员在 `/admin` 恢复。
  - `kie key's daily limit is used up: processing is paused`：kie 子密钥当天额度用完，全站返回 `PAUSED`，UTC 零点自动恢复。
  - 每个预算线在 80% 时还有一条预警（`BUDGETS.warnShare`）。
  - `Spend is running high today`：当日总成本 > 7 日均值 × 2。
  - `kie balance is running low`：余额撑不过 5 天平均花费。
- 注册量、免费重试率异常升高；同一 IP 段大量任务。

## 判断

1. 找来源（只读）：

   ```bash
   cd apps/api
   pnpm exec wrangler d1 execute DB --remote -c wrangler.production.jsonc --command \
     "SELECT ip_hash, visitor_hash, fp_hash, COUNT(*) AS n FROM jobs WHERE created_at > (strftime('%s','now') - 86400) * 1000 GROUP BY ip_hash, visitor_hash, fp_hash ORDER BY n DESC LIMIT 20"
   ```

2. 集中在少数哈希 → 被刷；分布正常、只是量大 → 真实流量增长（好事，看是否要提高上限、补余额）。
3. 付费任务成本高但收入正常 → 不是滥用，看是否改价（[model-removed-or-repriced.md](model-removed-or-repriced.md)）。

## 止损

1. 被刷：在 `/admin/jobs/<任务>` 页的 **Ban** 区，用任务上存的访客、设备、IP 段哈希直接封禁（写原因，先封 7 天）；明确的 IP 也可以在 `/admin/bans` 按网段封。
2. 免费档：如果熔断还没触发但想先停，`/admin` 勾 **Pause the free tier**（记为管理员暂停，ops 不会自动解除）。
   付费档：`/admin` 勾 **Pause paid jobs**，新的付费任务返回 `PAUSED`；可在 **Today's paid limit (USD)** 调整当日付费上限（留空恢复时为当天已花费 + 一整条付费预算线（仅在恢复 ops 自动暂停时））。
   每个用户的每日积分上限在 `/admin/users` 的 **Daily credit cap** 调整（留空为 catalog 默认）。
3. 整体成本失控：`/admin` → **Pause all processing**，同时去 kie 后台确认没有异常调用（密钥泄露时立即在 kie 轮换，`wrangler secret put KIE_API_KEY`）。
4. 余额低：kie 充值到至少 30 天用量（上线清单第 5 项）。

## 恢复

1. 封禁到期自动解除；确认误封时在 `/admin/bans` 点 **Lift**（最多 1 分钟后生效）。
2. 管理员暂停的免费档、付费档要手动取消勾选（付费档的预算暂停只有管理员能恢复）；ops 暂停的到 UTC 零点自动恢复。
3. 如果是持续性滥用，调低 `packages/catalog` 的频率或额度限制，走正常发布。
4. 观察 2 天，成本告警 `Resolved`。
