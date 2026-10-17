# 50 Christmases Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell the Christmas film in production: two live scenes, a working purchase, a Christmas inner page that ranks, and a home page that shows every film we make.

**Architecture:** The API and composer already make Christmas films (plans 1–2, R2 passed). This plan opens two scenes in the catalog, gives the web tool a story preset, fixes every zombie-only string a Christmas buyer would see, adds Stripe prices, updates the privacy policy, publishes `/ai-christmas-video` and the new home page, then deploys.

**Tech Stack:** TypeScript catalog/contracts/i18n, Hono Workers + DO + D1, Astro + React islands, Stripe Managed Payments, Python composer (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-15-christmas-story-design.md`, `docs/superpowers/specs/2026-10-16-christmas-content-design.md`, `docs/superpowers/specs/2026-10-16-story-showcase-design.md` (§5a "opening soon" is superseded: the owner chose to launch with the tool open), `docs/model-eval.md` § 圣诞.

## Owner decisions (2026-10-16)

- Launch **snow-cabin** and **city-flat**; **farmhouse stays `live: false`** (no full film tested).
- Video model stays Kling; aged look (silver hair, faces read early sixties) accepted; 0.4 s dissolves shipped; R3 skipped.
- Home page: featured-story first screen + film wall; H1 "AI couple videos from your photos"; Christmas page at `/ai-christmas-video`.

## Global Constraints

- Every number on a page or in an API response comes from `packages/catalog` (CLAUDE.md).
- Tests first, then code (CLAUDE.md).
- No prompt or model-route change in this plan (any change re-opens `eval/`, ≤ $10 a round).
- KIE and Stripe keys only in `~/.vzc-secrets/` and wrangler secrets; never printed, logged or committed.
- Production config never contains `PREVIEW_SCENES` (`apps/api/test/configs.test.ts:20` already guards it).
- Payment, ads and analytics accounts belong to VideoZombieCouple only; before any Stripe dashboard login, confirm the merchant is VideoZombieCouple.
- Samples show only AI-generated eval personas, labelled "AI example"; never a customer.
- Stage changes with `git add <paths>`; never `git add -A` (the owner keeps an untracked `docs/backlinks.md`).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A buyer with 10 credits on a 20-credit story** — the tool must say they need more and offer `christmas1`, never start a render that fails at hold time (Task 3 test `needs the story's credits, not a zombie video's`).
2. **Resuming a Christmas story** (reload, `/story?id=`) — the tool must restore story "christmas" and its scene, not fall back to `cabin-wheat` (Task 3 test `resumes a christmas story with its own scene`).
3. **A shared Christmas film link** — the share page must not say "A zombie love story" or 15 seconds (Task 4 test `shared film carries its story`).
4. **Ordering farmhouse by hand-crafted request** — API must refuse it in production (Task 1 test `farmhouse is not orderable in production`).
5. **Ledger after buying `christmas1`** — must read "1 Christmas film", not "+2 videos" (Task 4 test `a christmas grant reads as one christmas film`).

---

### Task 1: Catalog — open two scenes, put `christmas1` on sale, new-payer cap, wait time

**Files:**
- Modify: `packages/catalog/src/stories/christmas.ts:41-56` (per-setting `live`), `packages/catalog/src/limits.ts:140-145`, `packages/catalog/src/facts.ts` (new facts)
- Test: `packages/catalog/test/christmas.test.ts:13-19`, `packages/catalog/test/pricing.test.ts:37-46`, `apps/api/test/stories-api.test.ts:38-110`

**Interfaces:**
- Produces: `CHRISTMAS.scenes["snow-cabin"].live === true`, `["city-flat"].live === true`, `["farmhouse"].live === false`; `SALE_PRODUCTS` keys `["pack1","pack3","pack5","christmas1"]`; facts `story.christmas.minutes` (= 15) and `story.zombie.minutes` (= 5).

- [ ] **Step 1: Write the failing tests**
  - christmas.test: rename to `is well formed, 32 seconds, 20 credits, people only; snow-cabin and city-flat open, farmhouse not` — `expect(live).toEqual(["snow-cabin","city-flat"])`.
  - pricing.test: `christmas1 is on sale once a christmas scene is live` — `expect(SALE_PRODUCTS.map(p => p.key)).toEqual(["pack1","pack3","pack5","christmas1"])`; drop the temporary `live = true` toggling.
  - limits test: `a new payer can make five christmas films a day` — `expect(SPEND_CAPS.newPayerDailyCredits).toBe(100)`.
  - facts test: `fact("story.christmas.minutes") === 15`.
  - stories-api.test: `farmhouse is not orderable in production` (ENVIRONMENT=production, POST story christmas/farmhouse → `SCENE_UNAVAILABLE`); `snow-cabin is orderable in production`. Remove the `live = false` restores.
- [ ] **Step 2: Run** `pnpm --filter @vzc/catalog test && pnpm --filter @vzc/api test -- stories-api` — expect the new assertions to FAIL.
- [ ] **Step 3: Implement** — move `live` into each `SETTINGS` entry (`snow-cabin: true`, `city-flat: true`, `farmhouse: false`); `SPEND_CAPS.newPayerDailyCredits: 100`; add the two minute facts (measured 11–14 min per Christmas film in R2, zombie ≈ 5 min).
- [ ] **Step 4: Run** `pnpm test` — all PASS except `apps/api/test/configs.test.ts` STRIPE_PRICES coverage (fixed in Task 2).
- [ ] **Step 5: Commit** `feat(catalog): open snow-cabin and city-flat; christmas1 on sale; new payers 100 credits a day; wait-time facts`.

### Task 2: Stripe prices for `christmas1` (test and live)

**Files:**
- Modify: `apps/api/wrangler.jsonc:71`, `apps/api/wrangler.production.jsonc:67` (`STRIPE_PRICES`)
- Test: `apps/api/test/configs.test.ts:109-118` (existing; must pass)

- [ ] **Step 1:** `node scripts/stripe-setup.ts test` (dry run) — expect it to plan one new product `christmas1` ($9.99) and leave pack1/3/5 unchanged.
- [ ] **Step 2:** `node scripts/stripe-setup.ts test --yes`; paste the printed `STRIPE_PRICES` into `wrangler.jsonc`.
- [ ] **Step 3 (owner confirms first — creates a live Stripe product):** confirm the Stripe account is VideoZombieCouple in SunBrowser; `node scripts/stripe-setup.ts live --yes`; paste into `wrangler.production.jsonc`.
- [ ] **Step 4:** `pnpm --filter @vzc/api test -- configs` — PASS.
- [ ] **Step 5: Commit** `chore(billing): Stripe prices for christmas1 (test and live)`.

### Task 3: Web story tool speaks Christmas

**Files:**
- Modify: `apps/web/src/components/story/StoryTool.tsx` (props, credits check, packs, download name), `apps/web/src/lib/story/machine.ts:59,144`, `apps/web/src/lib/story/client.ts`, `apps/web/src/components/story/parts.tsx:111-159,210-224`, `packages/catalog/src/pages.ts:20-28` (`preset.story`), `packages/i18n/src/en.ts`
- Test: `apps/web/src/lib/story/machine.test.ts`, `apps/web/src/components/story/*.test.tsx`

**Interfaces:**
- Produces: `PageConfig.preset?: { story?: StoryId; kind?: Kind; scene?: string }`; `StoryToolProps.preset.story`; the create request carries `story`; `initialState(preset)` keeps a Christmas scene id.

- [ ] **Step 1: Write the failing tests**
  - `sends story "christmas" and the chosen christmas scene on create`.
  - `scene picker lists the story's own scenes; farmhouse shows "soon" and is disabled`.
  - `resumes a christmas story with its own scene` (view.story = "christmas", scene "city-flat" → state scene "city-flat").
  - `needs the story's credits, not a zombie video's` — 10 credits + story christmas → buy prompt, packs include `christmas1`.
  - `christmas stages have their own labels` — stages `frames, shot:1,2,3,5,6,7,8, compose` each map to a non-fallback label; `shot:5` is not "First light".
  - `film length comes from the story` — Christmas shows 32 s (`fact("story.christmas.seconds")`).
  - `christmas download is named our-christmas-film.mp4`.
- [ ] **Step 2: Run** `pnpm --filter @vzc/web test` — FAIL.
- [ ] **Step 3: Implement** — scenes, credits (`storyOf({story}).credits`), seconds and stage labels come from the story; slot labels for Christmas ("You", "Your partner"); `story.christmas.*` i18n keys (scene lines, stage labels, done caption "Our 50th Christmas.", title placeholder); `PackRows` gets the story's pack first. No zombie behaviour changes.
- [ ] **Step 4: Run** `pnpm --filter @vzc/web test && pnpm typecheck` — PASS.
- [ ] **Step 5: Commit** `feat(web): the story tool takes a story preset — Christmas scenes, credits, stages, length and pack`.

### Task 4: Share page, ledger and pricing page know the story

**Files:**
- Modify: `packages/contracts/src/stories.ts` (`SharedFilm.story`), `apps/api/src/routes/stories.ts` `getSharedFilm`, `apps/web/src/components/story/StoryTool.tsx:296-330`, `apps/web/src/lib/ledger.ts:23,44-50`, `apps/web/src/lib/pricing-view.ts`, `apps/web/src/templates/PricingPage.astro`, `packages/i18n/src/en.ts`
- Test: `apps/api/test/stories-api.test.ts`, `apps/web/src/lib/ledger.test.ts`, `apps/web/src/templates/pricing-page.test.ts`

- [ ] **Step 1: Write the failing tests**
  - API: `shared film carries its story` — a done Christmas story's share view has `story: "christmas"`.
  - Web: share view for christmas shows "50 Christmases" and 32 s, never "zombie".
  - `a christmas grant reads as one christmas film` — ledger row for reason `christmas1` → "1 Christmas film"; a 20-credit Christmas hold → "Christmas film".
  - `pricing page lists the Christmas film with its own price` — `$9.99` and "1 Christmas film" from the catalog.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the four changes (contract field, API, share copy, ledger/pricing rows).
- [ ] **Step 4: Run** `pnpm test` — PASS.
- [ ] **Step 5: Commit** `feat: share page, ledger and pricing know the Christmas film`.

### Task 5: Privacy policy names the describe step and Anthropic

**Files:**
- Modify: `apps/web/src/content/pages/en/privacy.mdx` (lines 49-81, `updated`)
- Test: `apps/web/src/content/legal.test.ts`

- [ ] **Step 1: Write the failing test** `privacy names every processor the Christmas film uses` — contains "Anthropic", "Claude", "Google (Gemini)", "clothing and hair", and does not claim photos reach models only after payment without the describe exception.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Write the copy:** for the Christmas film, after payment, both photos go through kie.ai to Anthropic (Claude) or, as fallback, Google (Gemini) to write a short description of visible clothing and hair; the text is used only to make that film, kept with the photos and deleted with them (`retention.photosDays`); no face features are derived from it. Update `updated:`.
- [ ] **Step 4: Run** `pnpm --filter @vzc/web test -- legal` — PASS.
- [ ] **Step 5: Commit** `docs(privacy): the Christmas describe step — Anthropic and Google via kie.ai, clothing and hair only, deleted with the photos`.

### Task 6: Christmas samples

**Files:**
- Create: `apps/web/public/samples/films/xmas-snow-cabin.mp4`, `-loop.mp4`, `xmas-city-flat.mp4`, `-loop.mp4`; `apps/web/src/assets/samples/film-xmas-*-poster.jpg`, `-memory.jpg`; `eval/scripts/encode_sample.sh`
- Modify: `apps/web/src/lib/samples.ts:65-77` (`SampleFilm.story`, ids), `apps/web/src/content.config.ts` (`film` enum)
- Test: `apps/web/src/lib/samples.test.ts`

**Sources (R2, AI personas):** snow-cabin = `eval/results/r2/films/snow-cabin/p03/film.mp4` (owner picks between p03/p06/p01), city-flat = `eval/results/r2/films/city-flat/p07/film.mp4`.

- [ ] **Step 1: Write the failing test** `every sample film names its story and has a loop and a poster` and `samples cover every live christmas scene`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3:** `encode_sample.sh <film.mp4> <id>` — full film (H.264 CRF 23, faststart, ≤ 4 MB), 4 s silent loop around 0:20 (the memory cut, ≤ 250 KB), poster at 1 s, memory still at 21 s. Add entries with `story` and alt text "AI example: …".
- [ ] **Step 4: Run** `pnpm --filter @vzc/web test` — PASS.
- [ ] **Step 5: Commit** `feat(web): Christmas sample films (AI personas from staging run R2)`.

### Task 7: `/ai-christmas-video` page

**Files:**
- Modify: `packages/catalog/src/pages.ts` (new `landing` page, `preset: { story: "christmas" }`, related home + zombie page), `apps/web/src/templates/HomePage.astro` (story-driven sections)
- Create: `apps/web/src/content/pages/en/ai-christmas-video.mdx`
- Test: `packages/catalog/test/pages.test.ts`, `apps/web/src/templates/*.test.ts`

- [ ] **Step 1: Write the failing tests** — page live with h1 "AI Christmas Video"; sitemap includes `/ai-christmas-video`; rendered page contains the tool preset to christmas, two scene samples, the beats from `CHRISTMAS.storyboard`, FAQ with gift/card questions, and no hard-coded price or seconds (all via `{{fact.*}}`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per showcase spec §5 (title/description carry "ai christmas video generator", "personalized christmas video"; wait time "about {{fact.story.christmas.minutes}} minutes").
- [ ] **Step 4: Run** `pnpm --filter @vzc/web test && pnpm --filter @vzc/web build` — PASS.
- [ ] **Step 5: Commit** `feat(web): /ai-christmas-video — the Christmas film page`.

### Task 8: Home page — featured story and film wall

**Files:**
- Modify: `packages/catalog/src/pages.ts` (home h1, `FEATURED`), `apps/web/src/templates/HomePage.astro`, `apps/web/src/content/pages/en/home.mdx`, `apps/web/src/components/layout/Header.astro:26`, `PhotoTool.tsx:125`, `PhotoPage.astro:144`, `BlogPage.astro:20`, `apps/web/src/lib/llms.ts`
- Create: `apps/web/src/components/FilmWall.tsx`
- Test: `packages/catalog/test/featured.test.ts`, `apps/web/src/templates/home-page.test.ts`

**Interfaces:**
- Produces: `featuredStory(now: number): StoryId` (catalog) — `FEATURED = [{ story: "christmas", from: "2026-11-01", until: "2026-12-26" }]`, default `"zombie"`, only stories with a live scene; `makeHref(now): string` — the featured story's page.

- [ ] **Step 1: Write the failing tests** — `featuredStory` returns christmas on 2026-11-15, zombie on 2026-10-20 and 2026-12-27; home H1 "AI couple videos from your photos"; first screen links to `/ai-christmas-video` when featured; film wall shows one tile per live story × scene (christmas ×2, zombie ×3, pet ×1) with filter chips; no tool on `/`; header "Make", photo/blog CTAs and the post-checkout return go to `makeHref`; no `/#make` left in `apps/web/src`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** per showcase spec §4; wall tiles show posters, loops load on view (`preload="none"`, IntersectionObserver); llms.txt gains the Christmas film and its price from the catalog; replace hard-coded "a few minutes" with the minute facts.
- [ ] **Step 4: Run** `pnpm test && pnpm --filter @vzc/web build && pnpm --filter @vzc/web verify` (Lighthouse budget: home LCP unchanged) — PASS.
- [ ] **Step 5: Commit** `feat(web): home shows every film we make — featured story and film wall`.

### Task 9: Release

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && (cd apps/composer && uv run pytest) && pnpm --filter @vzc/api dryrun` — all PASS.
- [ ] **Step 2:** `scripts/deploy.sh staging`; on staging buy `christmas1` with a Stripe test card, make one city-flat film end to end, check ledger, share link, `/ai-christmas-video`, home, sitemap.
- [ ] **Step 3:** fast-forward `feat/model-eval` to this branch, push it and `main` (owner confirms the push).
- [ ] **Step 4 (owner confirms):** `scripts/deploy.sh production`; smoke `{"ok":true}`; open `/ai-christmas-video`; one live `christmas1` checkout page loads (no purchase unless the owner wants one).
- [ ] **Step 5:** Google Search Console: submit the sitemap, request indexing of `/ai-christmas-video` and `/`.
- [ ] **Step 6:** Record the launch in `docs/lessons.md` and commit.
- [ ] **Step 7 (owner confirms each deploy):** rebuild and deploy production on 2026-11-01 and again on 2026-12-27 (`scripts/deploy.sh production`). The featured story (`FEATURED` in `packages/catalog/src/pages.ts`) switches only at build: without these deploys the home page and every "make a film" link keep the old story.

## Cost

| Item | Cost |
|---|---|
| Engineering | time only; no new services |
| Staging end-to-end check (1 film, Stripe test card) | ≈ $1.92 KIE |
| Optional live purchase check | $9.99 charged and refundable |
| Running cost per Christmas film | ≈ $1.92–1.96 model + Stripe fees ≈ $0.9–1.0 on $9.99 → ≈ $7 gross margin |
| Free remake (one per film, `REMAKES_PER_FILM`) | ≈ $1.92 model cost worst case per film (every buyer remakes); margin then ≈ $5 |
| New-payer cap 50 → 100 credits/day | worst case per fraudulent new account ≈ 5 films ≈ $10 model cost/day, still bounded by the KIE key's $60/day cap (`KIE_KEY_DAILY_CAP_USD`) |
| Page weight | film wall loads posters only; loops on view; samples ≤ 4 MB full, ≤ 250 KB loop |

## Security and compliance

- **Privacy:** the policy must name Anthropic and Google for the describe step before production (Task 5 gates Task 9).
- **Biometrics/region:** two-person films stay unavailable in Illinois (existing rule covers Christmas, `stories.ts:78`).
- **Face data:** unchanged — computed in composer memory only; appearance text lives in the Durable Object and is cleared with the photos.
- **Payments:** Stripe Managed Payments, VideoZombieCouple account only; live product created only after the owner confirms (Task 2 Step 3); webhook mode check unchanged.
- **Truthful claims:** prices, seconds, minutes, credits and deletion days come from the catalog; samples labelled "AI example"; no "free" claim.
- **Staging-only state:** `PREVIEW_SCENES` stays out of production config; the staging test account's extra credits and cap are staging-only.
- **AI disclosure:** film metadata and corner mark already say AI-generated (composer); unchanged.
- **Known gaps accepted at launch:** describe fallback (Gemini) has thin evidence; describe bypasses the KIE pause/breaker; films take 11–14 minutes (the page says about 15). Farmhouse stays closed until one full film passes.
