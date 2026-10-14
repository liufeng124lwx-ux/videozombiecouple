# Scene music

One instrumental per scene, used by the composer for the 12-second film (spec §4.2 S5). Uploaded to
R2 `assets/music/<scene>.m4a` on deploy.

| File | Scene | Source | kie task id | Generated |
|---|---|---|---|---|
| `cabin-wheat.m4a` | Cabin → Wheat field | Suno V6 via kie `ai-music-api/generate`, take 2 | d5926470a2861cf56d6fe39cd8175e6f | 2026-10-14 |
| `rain-chapel.m4a` | Rainy city → Chapel | Suno V6 via kie `ai-music-api/generate`, take 2 | b720c3715c7d483239e5bfab1fd939dd | 2026-10-14 |
| `lighthouse-beach.m4a` | Lighthouse → Beach | Suno V6 via kie `ai-music-api/generate`, take 2 | 9875b68a0ce2932538411e798b638771 | 2026-10-14 |

Prompts and settings: `eval/src/run-music.ts` (`custom_mode`, `instrumental: true`, `duration: 20`).
Post-processing: first 15 s, `loudnorm=I=-16:TP=-1.5`, 0.3 s fade-in, AAC 160 kbps stereo.

Takes were chosen by loudness envelope (quiet start, build to a peak around 8–12 s, matching the
cold → warm cut), then by ear.

**Licence:** generated through our own kie account. Before launch, confirm in kie's and Suno's
terms that tracks generated through the API may be used commercially (launch checklist). The
original viral video's music is never used (spec §8.1).
