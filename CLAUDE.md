# VideoZombieCouple

设计以 `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md` 为准；界面以 `docs/design/` 为准；实施计划在 `docs/superpowers/plans/`；模型结论在 `docs/model-eval.md`。踩过的坑在 `docs/lessons.md`（继承自 UnblurPix），动手前先看相关章节，解决新坑后补进去。

## 命令
- `pnpm install`、`pnpm lint`（`pnpm format` 自动修）、`pnpm typecheck`、`pnpm test`
- 单个包：`pnpm --filter @vzc/catalog test`
- API 打包检查：`pnpm --filter @vzc/api dryrun`
- composer：`cd apps/composer && uv run pytest`；镜像：`docker build -t vzc-composer apps/composer`
- 评测：见 `eval/README.md`（不进 workspace，不进 CI）

## 硬性规则
- 先写失败的测试，再写实现。
- 页面与接口里的数字只从 `packages/catalog` 读。
- 改提示词或模型路由之前，用 `eval/` 跑受影响的模型，每轮预算 ≤ $10。
- KIE 密钥只在 `~/.vzc-secrets/` 和 wrangler secret 里；绝不打印、写日志或提交。
- 人脸特征只在 composer 内存中计算，不落库、不写日志。
- 与 UnblurPix、video2mp4 的收款、广告、统计账号完全隔离；登录任何收款后台先确认商户属于 VideoZombieCouple。
