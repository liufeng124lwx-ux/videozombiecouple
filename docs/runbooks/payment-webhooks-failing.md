# 应急手册：支付 Webhook 持续失败

## 现象

- 告警：
  - `Payment webhooks are backing up`：有事件超过 1 小时未处理，或已失败 10 次（每日对账）。
  - `Waffo webhook: bad signatures in a row`：连续 3 次验签失败。
  - `Payments without an order`：已处理的付款事件在 `orders` 里没有对应行（每日对账）。
- 用户反馈「付了钱积分没到」；Sentry 里 `/webhooks/waffo` 的 500。

## 判断

1. 看未处理的事件（只读）：

   ```bash
   cd apps/api
   pnpm exec wrangler d1 execute DB --remote -c wrangler.production.jsonc \
     --command "SELECT id, type, attempts, error, received_at FROM billing_events WHERE processed_at IS NULL ORDER BY received_at DESC LIMIT 20"
   ```

2. 按 `error` 分：
   - 全部 401、没有入库 → 验签：Waffo 换了公钥（`WAFFO_WEBHOOK_PUBLIC_KEY`）、`WAFFO_MODE` 和事件的 mode 不一致，或有人在乱发请求（看来源 IP，只是探测就忽略）。
   - 入库了但 `error` 有内容 → 应用失败：`subscription … is not known yet`（事件乱序，后面会自己好）、`no user`（买家身份没带上）、D1 错误。
3. `Payments without an order`：拿告警里的 orderId 到 `/admin/users/<用户>` 看订单和积分流水。

## 止损

1. 验签问题：在 Waffo 后台核对 webhook 公钥和模式，`wrangler secret put WAFFO_WEBHOOK_PUBLIC_KEY -c wrangler.production.jsonc` 更新。
2. 应用失败且原因不明、用户还在付款：`/admin` 横幅写明「付款到账可能延迟，积分不会丢失」；必要时清空 `WAFFO_PRODUCTS`（wrangler 配置的 var）并部署，暂停收款。
3. 已经付了钱的用户：能在几小时内修好就等重放，不要手工加积分。手工加的积分（来源 `admin:…`）和重放时按订单号发放的积分是两笔，会重复。实在要先补，就在 `/admin/users/<id>` 加积分，原因写订单号，并记下名单；重放成功后，再用同一页面扣回手工加的那部分。

## 恢复

1. 修好原因并部署后，失败的事件由每小时的 `webhook-replay` 任务自动重放（最多 10 次）；Waffo 自己只重试 3 次。
2. 已失败 10 次的事件不会再自动重放：确认原因修好后，把它们的 `attempts` 清零，让下一小时重放：

   ```bash
   pnpm exec wrangler d1 execute DB --remote -c wrangler.production.jsonc \
     --command "UPDATE billing_events SET attempts=0, error=NULL WHERE processed_at IS NULL AND id IN ('<id>', ...)"
   ```

3. 第二天的对账告警全部 `Resolved`；抽查 3 个受影响用户的积分流水。
