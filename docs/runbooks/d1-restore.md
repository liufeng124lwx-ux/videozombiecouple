# 应急手册：D1 数据恢复

## 现象

- 数据被误删或改坏：误执行的 SQL、错误的迁移、有 bug 的代码批量写坏数据。
- 告警 `Credit ledger doesn't add up`（积分余额和流水对不上）、大量用户反馈数据丢失。

## 判断

1. 确定出问题的时间点（部署时间、执行命令的时间，或 Workers Logs 里第一条异常）。
2. Time Travel 窗口内（Workers 付费计划 30 天，免费计划 7 天；上线时确认账号是哪个计划）→ 用 Time Travel；更早 → 用每周备份（`vzc-backups/d1/d1-<日期>.sql.gz`，保留 12 周）。
3. 只坏了一小部分数据 → 优先在新库里恢复、对比后只修那部分，而不是整库回滚（整库回滚会丢掉之后的付款和任务）。

## 止损

1. `/admin` → **Pause all processing**，横幅说明维护中。账户和付款仍可用；如果问题涉及付款数据，再按 [payment-webhooks-failing.md](payment-webhooks-failing.md) 暂停收款（Waffo 事件之后可以重放）。
2. 停掉可能继续写坏数据的东西：回滚有问题的部署（`wrangler rollback -c wrangler.production.jsonc`）。

## 恢复

整库恢复（Time Travel）：

```bash
cd apps/api
pnpm exec wrangler d1 time-travel info DB -c wrangler.production.jsonc --timestamp "<出问题之前，ISO 时间>"
pnpm exec wrangler d1 time-travel restore DB -c wrangler.production.jsonc --timestamp "<同上>"
```

只修部分数据（推荐）。Time Travel 不能直接导出某个时间点，只能把同一个库整体切过去再切回来，所以要绕一下（切换期间库的内容是旧的，处理已经暂停，影响可控）：

```bash
cd apps/api
C=wrangler.production.jsonc
# 1. 记下现在的书签，回来时用
pnpm exec wrangler d1 time-travel info DB -c $C
# 2. 切到出问题之前，导出，再切回现在
pnpm exec wrangler d1 time-travel restore DB -c $C --timestamp "<出问题之前，ISO 时间>"
pnpm exec wrangler d1 export DB --remote -c $C --output before.sql
pnpm exec wrangler d1 time-travel restore DB -c $C --bookmark "<第 1 步的书签>"
# 3. 导进临时库，对比，写只修受影响行的 SQL，在正式库执行
pnpm exec wrangler d1 create vzc-restore
pnpm exec wrangler d1 execute vzc-restore --remote --file before.sql
```

用每周备份时跳过第 2 步：从 `vzc-backups/d1/` 下载对应的 `.sql.gz`（`wrangler r2 object get vzc-backups/d1/<文件> --file <文件> --remote`），解压后从第 3 步开始。对比完删掉临时库（`wrangler d1 delete vzc-restore`）和本地的 SQL 文件（里面有用户数据）。

恢复后：

1. Durable Object（钱包、任务）的状态不随 D1 回滚：每日对账会报出差异（积分流水、未结预扣、未处理付款）。对照告警逐条处理，必要时在 `/admin/users` 调整积分。
2. 时间点之后的付款事件：在 Waffo 后台导出，确认每笔都有积分发放；缺的按付款手册重放。
3. 取消暂停和横幅。
4. 每季度在测试环境演练一次本手册（设计 8.5），记下用时。
