# 应急手册：kie 整体故障

## 现象

- 告警（Telegram + 邮件）：
  - `Health check failed: unblur.std`（或 `unblur.pro`）：每小时一次的健康检查失败（7A，`ops/health.ts`）。
  - `unblur.std is failing`：某能力 15 分钟失败率 > 20%（至少 10 次调用）。
  - 同时出现多条 `Breaker open: <model>`：几个模型的熔断器都打开了（Dispatcher，最近 20 次失败过半）。
- Sentry 里 `PROVIDER_DOWN` / `TIMEOUT` 相关错误增多；用户看到「服务繁忙，请稍后重试」，积分和额度自动退回。

## 判断

1. 打开 `/admin/jobs`，查最近失败的任务，看每次尝试的 `failKind` / `failMsg`：
   - 主用和备用（都是 kie 的模型）同时报网络错误、5xx 或超时 → kie 整体故障；
   - 只有一个模型失败 → 按 [model-removed-or-repriced.md](model-removed-or-repriced.md) 处理。
2. 用 kie 的成功率接口确认（密钥只从 `~/.vzc-secrets/eval.env` 读，不要打印）：
   `GET https://api.kie.ai/api/v1/models/<model>/success-rate`，最近几个点 `successRate` 很低或 `isNormal: false`。
3. 余额也会导致全部失败：看是否同时有 `kie balance is running low`，或 `failMsg` 里有 402。余额不足就去 kie 充值，不用走下面的止损。

## 止损

1. `/admin` → 勾选 **Pause all processing** → Save。新任务返回 `PROVIDER_DOWN`（不扣费），账户和付款照常。
2. 同一页填横幅文字（例如 "Processing is paused while our provider recovers. Your credits are safe."），链接留空或填站内路径，Save。
3. 正在跑的任务不用管：超过超时 2 倍未结束的，ops 每 5 分钟先唤醒、下一轮放弃并退回（`TIMEOUT`）。

## 恢复

1. kie 成功率恢复后，`/admin` 取消 **Pause all processing**，清空横幅，Save（其他 isolate 最多 1 分钟后生效）。
2. 打开网站，用首页的示例照片点 Unblur，确认能出结果（后台没有运行任务的按钮）；下一次每小时健康检查（`ops/health.ts`）成功时告警会发 `Resolved`。
3. 第二天检查 `Credit holds left open` 告警没有出现（所有预扣都已退回或结算）。
4. 故障持续超过 1 小时，复盘是否需要第二供应商（上线清单第 2 项）。
