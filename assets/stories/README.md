# Story assets

Made once per scene and uploaded to R2 `assets/stories/…` on deploy (`scripts/deploy.sh`). Every
order reuses them: they cost nothing per film and never fail.

## christmas/<scene>/ (christmas spec §3.2)

| File | What | How |
|---|---|---|
| `ornament.jpg` | The red glass heart ornament with a gold ribbon, plain background | 即梦 (Seedream), one image per scene |
| `hands.mp4` | Shot 4: old hands open a faded red box, the thumb brushes the ornament, lifts it out of frame (≥ 3 s) | keyframe in 即梦 → image-to-video, 3–5 s |
| `window.mp4` | Shot 9: from outside, the lit tree through the window, snow, dawn coming (≥ 4 s) | keyframe in 即梦 → image-to-video, 4–5 s |
| `music.m4a` | 32 s: music and sound effects on the storyboard's timeline (clock, wind, floor, box, chimes, laughter; silence at 0:10–0:13; drum hit at 0:20) | suno.com during the Suno Pro subscription, mixed to the timeline; licence recorded in assets/music/README.md style: Suno song id, plan and date per file, added here when generated |

Scenes: `snow-cabin`, `city-flat`, `farmhouse`. A scene goes `live: true` in
`packages/catalog/src/stories/christmas.ts` only after its four files are here and its prompts
passed the eval.

## Provenance

| File | Made with | Date | Prompt / source | Notes |
|---|---|---|---|---|
| `christmas/shared/ornament.jpg` | KIE `gpt-image-2-text-to-image`, 1K, 9:16, candidate 2 of 2 (eval run `xassets1`) | 2026-10-16 | "Product photo of one red glass heart-shaped Christmas ornament with a gold ribbon loop tied in a small bow at the top, glossy glass with soft reflections, a little worn with age, centred on a plain warm off-white background, soft studio light. A single object, no other ornaments, no text." | Prompt direction tested in 即梦 first; chosen by the owner (older, deeper red reads as a fifty-year-old keepsake). Converted PNG → JPEG q92. |
