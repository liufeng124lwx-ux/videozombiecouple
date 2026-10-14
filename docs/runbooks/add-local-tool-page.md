# 上线一个本地工具页

本地工具的引擎和组件已经就绪（`docs/superpowers/specs/2026-10-13-local-image-tools-design.md`）。
新页面只需要 catalog 一条记录和一个 MDX。按规格第 6 节的顺序，上一个页面被 Google 收录后再上下一个。

## 1. 立项检查（上线前五个页面必须做）

用哥飞 MCP 对这个页面的核心词跑一次 `keyword_difficulty`（哥飞版 KD，2 积分），结果写进
`docs/research/` 的调研报告第 2.4 节表格。KD ≥ 60 时先停下来和用户商量。

## 2. catalog

在 `packages/catalog/src/pages.ts` 的 `heic-to-jpg` 后面加一条，id、slug、tool 三者相同：

    {
      id: "<tool id>",
      kind: "local-tool",
      tool: "<tool id>",
      locales: { en: { slug: "<tool id>", status: "draft", h1: "<规格第 3.5 节的 H1>" } },
      related: ["home", "heic-to-jpg"],
    },

`pnpm --filter @vzc/catalog test` 必须通过（会检查 tool 和 id 一致）。

## 3. 正文

复制 `apps/web/src/content/pages/en/heic-to-jpg.mdx` 的结构写 `<tool id>.mdx`：
- frontmatter 字段：title、description、card、lede、howTo、uses（4 条）、steps（正好 3 条）、features（4 条）、faq（6–8 条）。
- 数字一律写 `{{local.maxFiles}}`、`{{local.target1}}` 或正文里的 `<F k="…" />`，不手写。
- 正文 4 个二级标题左右，讲清楚这个格式 / 操作是什么、工具怎么做、批量、出问题怎么办。
- H1 不写在 MDX 里，由模板从 catalog 读。
- 正文字数必须在 1200–1800 个英文词之间（`apps/web/scripts/checks.ts` 的 `checkToolPages`，`verify` 时检查）。heic-to-jpg 第一版只写了四个短节，字数不够，后来补了「为什么 iPhone 用 HEIC」「格式对比」「隐私」等几节才通过。新页面写完先数一遍字数，不要等到 verify 才发现。
- 页面模板用 `client:after-load` 挂载 `ImageTool`（在 load 事件之后挂载，保证 LCP < 2.5s）。挂载前选择按钮是禁用的，本地工具页也屏蔽了窗口级拖放。新页面不需要为此改模板。

## 4. 检查

    pnpm lint && pnpm typecheck && pnpm test
    pnpm --filter @vzc/web verify
    pnpm --filter @vzc/web browser-check
    pnpm --filter @vzc/web lighthouse

browser-check 的「local tools」块对每个有 `tool` 的 local-tool 页都跑同一套通用检查：挂载前按钮禁用、
选文件前不下载编解码器、挂载后按钮可用。结果检查只对**输出保持原尺寸并给出下载**的工具成立
（选一张 60×40、EXIF 方向 6 的照片，期望下载到 40×60 的竖图，下载数等于文件数）。按工具分：

| 工具 | 通用块覆盖什么 | 还需要自己加的 browser-check |
| --- | --- | --- |
| heic-to-jpg、jpg-to-png 等 convert | 全部（竖图、下载数；heic-to-jpg 另查输出是 JPG） | 无（新格式的输出类型检查照 heic-to-jpg 加一行） |
| compress-image / compress-png / compress-jpeg | 竖图、下载数 | 「PNG 压到 100 KB 后 ≤ 100 KB」（规格第 4 节）和目标大小检查 |
| remove-exif-data | 竖图、下载数 | 真实样张：一张带 GPS 的相机 JPEG，下载后用 sharp / EXIF 读不到 GPS |
| flip-image | 竖图、下载数（默认不翻转） | 点一次翻转后的像素检查 |
| image-resizer | 无：尺寸会变，通用块直接报「needs its own browser check」失败 | 缩放结果的尺寸 |
| crop-image | 无：1:1 出 40×40，同上直接失败 | 裁剪结果尺寸和对比框（见下） |
| blur-face | 只查结果出来了、无人脸时没有下载；另报「needs its own browser check (a face fixture)」失败 | 带人脸的样张：检测到框、模糊后可下载 |

所以 crop-image、image-resizer、blur-face 进 `PAGES` 的同一个提交里，必须带上它们自己的 browser-check，
并在通用块里把对应的占位失败换成真检查，否则 browser-check 不过。

## 上线闸门（status 改成 live 之前每页必须满足）

- 所有页面：第 1 节的哥飞 KD 检查已做并记录。
- remove-exif-data：browser-check 里的真实样张剥离检查（带 GPS 的相机 JPEG → 下载文件无 GPS，用 sharp 或 EXIF 读取确认）；WebP 保留方向的测试。
  - 找不到主图结束标记（EOI）、或两次扫描之间的段长度损坏的 JPEG，现在会保留到文件末尾的全部字节；上线前改成和扫描前一样直接拒绝（`UNSUPPORTED`）。
  - 渐进式 JPEG 两次扫描之间的 APPn / COM 段目前原样保留（正常相机不会写在这里）；上线前决定是否一并删除，删除会让「扫描数据逐字节不变」的测试需要改写。
- crop-image：对比框不能把裁剪后的结果叠在未裁剪的原图上（先修好两边宽高比不一致的问题）。
- blur-face：人脸框按索引作 key；「Face N」的 aria-label 走 i18n；browser-check 里有人脸样张。
- flip-image：翻转按钮组（chips）有 aria-label。
- compress-image / compress-png / compress-jpeg：browser-check 里有「PNG 压到 100 KB 后 ≤ 100 KB」（规格第 4 节）和目标大小检查。
  - compress-image 的正文要说明：选了目标大小时，图形和透明图会输出 WebP。
- image-resizer：browser-check 检查缩放结果的尺寸。
  - 缩放结果超过兆像素上限时，现在显示的是通用的「超过 N 兆像素」提示；上线前换成针对缩放的文案（例如「缩放后太大了」）。

## 5. 上线

把 `status` 改成 `"live"`，加 `liveSince: "<YYYY-MM-DD>"`，在首页或相关页面的 `related` 里加上它，提交并按正常流程部署。部署后在 GSC 提交网址，等收录。

## 编辑器页面（kind: "editor"）

编辑器任务页（规格 `docs/superpowers/specs/2026-10-14-photo-editor-design.md` 第 3.4 节）和本地工具页的上线方法相同，区别只有三处：

1. catalog 记录写 `kind: "editor"` 和 `editor: "<page id>"`（id、slug、editor 三者相同），预设已经在 `EDITOR_PAGES` 里。
2. 模板是 `EditorPage.astro`，不需要改；正文同样 1200–1800 词。
3. browser-check 的「editor pages」块会自动覆盖新页面（打开、下载、原尺寸）。取色以外的页面，上线前在该块里补一条针对预设的像素检查（例如 invert：下载图的平均色约等于 255 减原图平均色）。

change-color-of-image 上线前先看一次谷歌搜索结果，确认「替换颜色」满足搜索意图（规格第 7 节）。
