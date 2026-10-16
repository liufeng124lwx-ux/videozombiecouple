# Story assets

Made once per scene and uploaded to R2 `assets/stories/…` on deploy (`scripts/deploy.sh`). Every
order reuses them: they cost nothing per film and never fail.

## christmas/<scene>/ (christmas spec §3.2)

| File | What | How |
|---|---|---|
| `shared/ornament.jpg` | The red glass heart ornament with a gold ribbon, plain background | KIE GPT Image 2 (prompt tuned in 即梦), shared by all scenes |
| `shared/hands.mp4` | Shot 4: old hands open a faded red box, the thumb brushes the ornament, lifts it out of frame (≥ 3 s) | GPT Image 2 frame → Kling image-to-video via KIE (prompts tuned in 即梦), shared |
| `window.mp4` | Shot 9: from outside, the lit tree through the window, snow, dawn coming (≥ 4 s) | GPT Image 2 frame → Kling image-to-video via KIE (prompts tuned in 即梦) |
| `music.m4a` | 32 s: music and sound effects on the storyboard's timeline (clock, wind, floor, box, chimes, laughter; silence at 0:10–0:13; drum hit at 0:20) | suno.com during the Suno Pro subscription, mixed to the timeline; licence recorded in assets/music/README.md style: Suno song id, plan and date per file, added here when generated |

Scenes: `snow-cabin`, `city-flat`, `farmhouse`. A scene goes `live: true` in
`packages/catalog/src/stories/christmas.ts` only after its four files are here and its prompts
passed the eval.

## Provenance

| File | Made with | Date | Prompt / source | Notes |
|---|---|---|---|---|
| `christmas/shared/ornament.jpg` | KIE `gpt-image-2-text-to-image`, 1K, 9:16, candidate 2 of 2 (eval run `xassets1`) | 2026-10-16 | "Product photo of one red glass heart-shaped Christmas ornament with a gold ribbon loop tied in a small bow at the top, glossy glass with soft reflections, a little worn with age, centred on a plain warm off-white background, soft studio light. A single object, no other ornaments, no text." | Prompt direction tested in 即梦 first; chosen by the owner (older, deeper red reads as a fifty-year-old keepsake). Converted PNG → JPEG q92. |
| `christmas/shared/hands.mp4` | Kling 3.0 std image-to-video via KIE, 5 s, eval run `xassets1`, prompt "The old hands lift the heart ornament gently out of the box and carry it up out of frame; the thumb brushes it once. Static camera. Subtle, restrained motion, no extra fingers." | 2026-10-16 | First frame `hands-2.jpg`: GPT Image 2 image-to-image from the ornament, prompt `ASSET_PROMPTS.hands` in `eval/src/run-assets.ts` | Prompt tested in 即梦 first; frame picked by the owner. Checked frames at 0.5/2.5/4.5 s: five fingers, ornament unchanged. |
| `christmas/snow-cabin/window.mp4` | Kling 3.0 std image-to-video via KIE, 5 s, eval run `xassets1`, prompt "Snow keeps falling past the warm lit window while the dawn sky slowly brightens. Very slow push-in. Subtle, restrained motion." | 2026-10-16 | First frame `window-snow-cabin-1.jpg`: KIE `gpt-image-2-text-to-image` 1K 9:16, `ASSET_PROMPTS.windowPrompt` | Prompt tested in 即梦 (dreamina-canvas CLI) first; frame picked by the owner. |
| `christmas/city-flat/window.mp4` | Kling 3.0 std image-to-video via KIE, 5 s, eval run `xassets1`, prompt "Snow keeps falling past the warm lit window while the dawn sky slowly brightens. Very slow push-in. Subtle, restrained motion." | 2026-10-16 | First frame `window-city-flat-2.jpg`: KIE `gpt-image-2-text-to-image` 1K 9:16, `ASSET_PROMPTS.windowPrompt` | Prompt tested in 即梦 (dreamina-canvas CLI) first; frame picked by the owner. |
| `christmas/farmhouse/window.mp4` | Kling 3.0 std image-to-video via KIE, 5 s, eval run `xassets1`, prompt "Snow keeps falling past the warm lit window while the dawn sky slowly brightens. Very slow push-in. Subtle, restrained motion." | 2026-10-16 | First frame `window-farmhouse-1.jpg`: KIE `gpt-image-2-text-to-image` 1K 9:16, `ASSET_PROMPTS.windowPrompt` | Prompt tested in 即梦 (dreamina-canvas CLI) first; frame picked by the owner. |
