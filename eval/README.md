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
