# 应急手册：某个模型被下架或改价

## 现象

- 告警 `unblur.<能力> is failing`，失败集中在一个模型；或 `Breaker open: <model>` 反复出现、不再 `Resolved`。
- 改价：`Spend is running high today`（当日成本 > 7 日均值 × 2）或 `kie balance is running low` 来得比预期早，任务量却没变。

## 判断

1. `/admin/jobs` 看失败尝试的 `failMsg`：模型不存在（404）、参数校验失败（422）→ 下架或接口改了。
2. 查 kie 目录：`GET https://api.kie.ai/api/v1/models?q=<模型名>`；查价格：`GET https://api.kie.ai/api/v1/models/<model>/price`，和 `packages/catalog/src/routes.ts` 里该路由的 `costUsd` 对比。
3. 改价后要核对定价保护（设计 6.8：积分 × 最低单积分价 ≥ 主用成本 × 1.5，且 ≥ 备用成本）：`pnpm --filter @vzc/catalog test` 会在 catalog 改价后直接失败。

## 止损

1. `/admin/routes`：把出问题的路由取消 **on**，Save。同一能力的备用路由接手（同一排序的并行路由一起跑，下一个排序作备用）。
2. 如果这个能力已经没有可用路由：`/admin` 把该能力勾进 **Capabilities offline**，新任务返回 `PROVIDER_DOWN`，免费重试也会被拒。
3. 只是改价且仍然赚钱：先不动，按下面的恢复流程改 catalog；亏钱则立即按第 1 步关掉。

## 恢复

1. 在 `packages/catalog` 改路由（换模型、改参数或成本）。按 `CLAUDE.md`：改路由或提示词之前，用 `eval/` 的 12 张评测图跑受影响的模型，预算 $1。
2. 提 PR → 合并 main → `deploy.yml` 部署。部署里的路由同步只更新 catalog 管的列（模型、参数、成本等），保留后台改过的开关、排序、超时。
3. 部署后到 `/admin/routes` 把第 1 步关掉的路由重新打开（如果新 catalog 仍保留它），取消能力下线。
4. 观察一天：`Breaker open` 没有再出现，成本告警 `Resolved`。
