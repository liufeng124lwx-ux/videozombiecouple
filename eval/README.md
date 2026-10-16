# 模型评测

目标：选出关键帧（图像编辑）和分镜（图生视频）的默认模型与备用模型，测出单次预览成本和单条视频成本。设计见 `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md` §10。

## 准备
- key：`~/.vzc-secrets/eval.env` 里写 `KIE_API_KEY=...`（不进仓库、不打印）。
- 工具：Node ≥ 24、`uv`、`ffmpeg`（`brew install uv ffmpeg`）。
- 测试：`node --test eval/test/`

## 一轮完整流程
```bash
node eval/src/run-personas.ts --yes                                   # 合成人物照片（约 $0.6，只需一次）
node eval/src/run-keyframes.ts --run r1 --stage AC                    # 看计划和预估
node eval/src/run-keyframes.ts --run r1 --stage AC --yes              # 执行
uv run eval/scripts/face_score.py eval/results/r1                     # 打分 + 挑每组最佳
node eval/src/run-keyframes.ts --run r1 --stage B --models nb2 --yes  # 用最佳 A/C 生成 B
uv run eval/scripts/face_score.py eval/results/r1
node eval/src/run-shots.ts --run r1 --kf-model nb2 --pairs p01,p07 --yes
uv run eval/scripts/face_score.py eval/results/r1
uv run eval/scripts/stitch.py eval/results/r1
uv run eval/scripts/report.py eval/results/r1                         # 打开 review.html 盲评
```

## 怎么判定
1. 盲评为主：每个关键帧 / 成片打 1–5 分（像不像本人、情绪、转场），导出 `ratings.json`。
2. 人脸相似度为辅（insightface 余弦相似度，越高越像）。
3. 一票否决：两张脸混合、性别或肤色被改、出现血腥画面的比例超过 10%。
4. 记录成功率、p50 / p90 耗时、实际花费（kie 返回的 `creditsConsumed`，1 积分 = $0.005）。

结论写进 `docs/model-eval.md`。

## 圣诞评测

设计与验收见 `docs/superpowers/specs/2026-10-16-christmas-content-design.md` §4–§5。每个脚本不加 `--yes` 只打印计划与预估；加了才调用，开始与结束各查一次 KIE 余额（`GET /api/v1/chat/credit`），打印实测花费 =(前−后)×$0.005。遇 KIE `433`（每小时额度）立即停止：等一小时后加 `--resume` 继续（跳过已有产物）。产物都在 `eval/results/<run>/`（git 忽略）；人脸特征只在 `xmas_face.py` 进程内存中。

| 轮次 | 命令 | 预算 |
|---|---|---|
| R0 描述 | `node eval/src/run-describe.ts --run r0 --yes` → `describe.csv`、`raw/*.txt` | ≈ $0.05（实估 $0.012） |
| 素材 | `node eval/src/run-assets.ts --run assets-r1`，再按 `--stage ornament` → `frames` → `clips` 逐段加 `--yes`；每段之间人工把选中的文件名写进 `asset-picks.json` | ≈ $1.6 |
| R1 关键帧 | 选好的挂饰复制到 `assets/stories/christmas/shared/ornament.jpg`（或 `--ornament`），`node eval/src/run-xmas-keyframes.ts --run xr1 --yes`：描述 → 第 1 轮 8 张候选 → `xmas_face.py` 挑选 → tree、forgetWarm → embrace | ≈ $2.5 |
| R2 成片 | `node eval/src/run-staging-films.ts --run r2 --scene snow-cabin --pairs p01,p03,p06 --yes`，再 `--scene city-flat --pairs <一组>` | ≈ $8 |
| R3 成片 | `--run r3 --scene farmhouse --pairs <两组>`，再 `--scene city-flat --pairs <两组>` | ≈ $8 |
| 打分 | `uv run eval/scripts/xmas_face.py eval/results/<run>` → `faces.csv`、`faces-summary.json`、`xmas-picks.json` | 免费 |

- 素材脚本不会覆盖 `assets/stories/`：人挑选、复制，并在 `assets/stories/README.md` 记模型、日期、提示词（`prompts.json`）。
- 成片脚本只认测试站，读 `~/.vzc-secrets/smoke-session-staging`（`--session-file` 可换）与 `smoke-staging`，不打印；先查测试账号积分 ≥ 单数 × 20；**一单接一单**，一单失败就停。中断后 `--resume` 会继续轮询已下的单，不重复下单；要重下某组，删掉它的目录。
- `eval/results/r1` 里是早先丧尸评测的产物；圣诞脚本只写自己的文件（`kf/<scene>/`、`kf/xmas-results.jsonl`、`xmas-picks.json`、`faces.csv`），不动它的 `picks.json`，但新开 `--run`（如 `xr1`）更清楚。

**验收（每个场景，spec §5）**：选中帧性别画反 0 次（`faces-summary.json` 的 `gender_flips_selected`）；头巾/胡子/光头保留 100% 且不凭空添加（看 `describe.csv` 与关键帧）；年轻回忆（`memory`）人脸相似度中位数 ≥ 0.6；老年帧相似度只记录，用户盲看 5 组中 ≥ 4 组认得出；tree/embrace 只有一颗挂饰；镜头 1、2、6 不变形、镜头 5 树灯亮起、镜头 7 白闪自然；每单实测模型费 ≤ $2.3；p90 耗时 ≤ 10 分钟（`story.json` 的 `minutes`）；用户看 3 条完整样片通过。

结论写进 `docs/model-eval.md` 的圣诞章节。
