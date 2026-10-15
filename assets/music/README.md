# Scene music

One instrumental per scene, used by the composer for the 12-second film (spec §4.2 S5). Uploaded to
R2 `assets/music/<scene>.m4a` on deploy.

| File | Scene | Suno song id (chosen take) | Other take | Generated |
|---|---|---|---|---|
| `cabin-wheat.m4a` | Cabin → Wheat field | f1dd9874-6759-4c8f-9eed-bba63cd0cb6f (0:48) | ad338155-09b3-4c8c-b4bb-6adc84e474dc | 2026-10-15 |
| `rain-chapel.m4a` | Rainy city → Chapel | 5de01786-722a-41ce-b2d6-76656f8b4826 (0:48) | f6fefe7a-6261-4d7d-86a3-b406ddf215d5 | 2026-10-15 |
| `lighthouse-beach.m4a` | Lighthouse → Beach | 3e665ac6-51f5-40de-95ab-a1151b767510 (1:19) | 9210c18d-7c3e-4367-8227-c9428f8fb321 | 2026-10-15 |

**Licence:** generated on suno.com (model v6, instrumental, custom style prompt) by the account
liufeng124_lwx **while on the Suno Pro plan** (monthly, next billing 2026-11-14). Suno grants
commercial use rights for songs generated during an active paid subscription, and keeps them after
the subscription ends. Downloaded as WAV through Suno's Download. The earlier tracks made through
kie's Suno API (no Suno subscription, no clear commercial grant) are no longer used. The original
viral video's music is never used (spec §8.1).

Style prompts (also in `eval/src/run-music.ts`):
- cabin-wheat: "cinematic emotional piano and strings, slow build, tense low drone first, a single soft drum hit at 8 seconds, then warm hopeful strings, no vocals"
- rain-chapel: "cinematic rain ambience into tender piano and cello, slow build, a single soft drum hit at 8 seconds, warm resolution, no vocals"
- lighthouse-beach: "cinematic ocean ambience into emotional strings and piano, slow build, a single soft drum hit at 8 seconds, warm hopeful ending, no vocals"

**Choosing a take:** per-second loudness of the first 15 s; the take that stays quiet through the
standoff and builds to its peak after the cut to the memory (8 s) wins, then by ear.

**Post-processing:** first 15 s, `loudnorm=I=-16:TP=-1.5`, 0.3 s fade-in, 0.6 s fade-out, AAC
160 kbps, 48 kHz stereo.
