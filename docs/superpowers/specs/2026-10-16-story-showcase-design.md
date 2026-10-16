# Story showcase: home page and the Christmas inner page — design

Date: 2026-10-16 · Status: approved direction; owner review of this document pending · Builds on
`2026-10-15-christmas-story-design.md` and `2026-10-16-christmas-content-design.md`.
This is the web/SEO half of the third plan (launch of "50 Christmases").

## 1. Why

The site is new and the home page today is one story: the zombie couple (hero film, upload tool,
gallery, beats, pricing; the pet version is a small band near the bottom). When "50 Christmases"
ships, nobody arriving on the home page would learn it exists, and visitors rarely click through
to find out what else we make. The owner wants:

- the home page to **show the videos we can make**, so a visitor sees what they would get before
  being asked for photos;
- each story to have **its own inner page** that can rank for its own keywords;
- keyword coverage good enough for a new domain to beat the incumbents — in practice, to be
  indexed and ranking before the December Christmas peak.

## 2. Keyword evidence (US, Google Ads Keyword Planner via the 哥飞 SEO toolbox, 2026-10-16)

| Keyword | Avg / month | Dec peak | 哥飞 KD | Notes |
|---|---|---|---|---|
| ai christmas photo | 6,600 | 74,000 | 41 (medium) | weakest top-10 site is DR 7; intent is a **photo**, not a video |
| ai christmas card | 590 | 4,400 | — | card intent |
| ai christmas video | 50 | 390 | 46 (medium) | weakest top-10 is DR 28; 3 of 10 slots are YouTube |
| ai christmas video generator | 40 | 390 | — | same cluster |
| personalized christmas video | 30 | 210 | — | closest intent to our product |
| ai couple video generator | 40 | 140 | — | |
| ai video from photo | 720 | — | 30 (easy) | generic; big sites rank with non-dedicated pages |
| ai kissing video / ai hug video | 1,300 / 110 | — | — | declining all year |
| ai zombie video, zombie couple ai | ~0 | — | — | social traffic only |

Conclusions the design follows:

1. The Christmas inner page targets the **"AI Christmas video" cluster** (ai christmas video,
   ai christmas video generator, personalized christmas video): about 1,000 searches in December,
   with intent that matches the product exactly.
2. The home page targets the **generic couple/photo-to-video terms** (ai couple video generator,
   ai video from photo) and does not put "AI Christmas video" in its H1, so the home page and the
   inner page do not compete for the same query.
3. Zombie terms have no search volume; the zombie pages stay as they are and live on social traffic.
4. **"ai christmas photo" is the largest prize but a different product** (the searcher wants a
   still image). Out of scope here; recorded in §9 as the next opportunity.
5. **Timing beats polish**: the inner page must be live and indexed well before December.
   Target: **live by 2026-11-15**.

## 3. Goals, non-goals, anti-goals

Goals
- Home page that shows every film we can make and sends visitors to the right story page.
- A Christmas inner page at `/ai-christmas-video` with the upload tool on its first screen.
- A "featured story" setting in the catalog so the home page's first screen follows the season
  without template edits.

Non-goals
- An AI Christmas photo product (§9).
- Separate pages per Christmas scene (three thin pages would read as near-duplicates; one strong
  page instead).
- New zombie or pet sample films; the existing ones are reused.
- Locales other than English.

Anti-goals (failure even if it "works")
- A wall of autoplaying videos that wrecks load time on phones (LCP regression on the home page).
- The home page outranking or cannibalising the Christmas page for "ai christmas video".
- Any sample showing a real customer, or numbers on the page that do not come from
  `packages/catalog`.

## 4. Home page (decided with the owner: "B's first screen + C's film wall")

Mockups: `.superpowers/brainstorm/33088-1792153857/content/home-layout-v2.html`.

Top to bottom:

1. **First screen — the featured story.** Left: one large film of the featured story (now
   50 Christmases), silent loop, poster first. Right: small eyebrow ("New for Christmas · 50
   Christmases"), H1, one-line subtitle, one big button ("Make your Christmas film →") that links to
   the featured story's inner page.
   - **H1 = "AI couple videos from your photos"** (owner approved replacing "AI Zombie Couple
     Video"). Christmas appears only in the eyebrow, subtitle and button.
2. **Film wall — "Every film we can make".** Filter chips: All · Christmas · Zombie · Pet. One tile
   per story × scene: Christmas ×3 (snow cabin, city flat, farmhouse), Zombie ×3 (cabin, chapel,
   beach), Pet ×1. Each tile: silent loop with poster, caption "story · scene", and the whole tile
   links to that story's inner page (with the scene preselected where the page supports it).
   Captions carry scene words for long-tail coverage.
3. **How it works (3 steps), Pricing, FAQ** — existing sections, trimmed to what applies to all
   stories. Numbers from the catalog.
4. The upload tool **leaves the home page**: a visitor picks a story first, because stories need
   different photos (two people vs. a person and a pet). The inner page has the tool on its first
   screen, so home → upload is one click.

Featured story (my call): a catalog entry, e.g. `FEATURED = [{ story: "christmas", from:
"2026-11-01", until: "2026-12-26" }, …]` with a default (the zombie story). The Christmas window
opens on the later of 2026-11-01 and the day its page is published — the zombie story keeps the
home page through Halloween (my call). The site is built
statically, so the switch happens at the next build after the date; the builder decides whether
that is a scheduled rebuild or a dated deploy reminder. A story is eligible once its inner page is published
(including the "opening soon" state in §5a); the featured button then links to that page.

## 5. Christmas inner page `/ai-christmas-video`

Mockup: `.superpowers/brainstorm/33088-1792153857/content/xmas-page.html`.

Top to bottom:

1. **First screen.** Left: the main sample film. Right: H1 **"AI Christmas Video"**, subtitle with
   "personalized Christmas film of the two of you, 50 Christmases from now — two photos, N seconds,
   $P" (N, P from the catalog), then the **upload tool preset to the Christmas story**: scene chips
   (snow cabin / city flat / farmhouse; only `live` scenes shown), two photo slots, button.
   Title/description carry "ai christmas video generator" and "personalized christmas video".
2. **"Three Christmas films, three homes"** — one sample film per scene.
3. **"What happens in your N seconds"** — the beats from the storyboard (timings from the catalog).
   This is our difference from card templates and gives the page real body text.
4. **How it works · What photos work best · Privacy (photos deleted after N days, from the
   catalog) · FAQ** — FAQ answers gift and "send it as a Christmas card" questions (catches
   ai christmas card / christmas video gift phrasing). Footer links back to home and the other
   stories.

Page plumbing: a new `PAGES` entry of kind `landing` with `preset: { story: "christmas" }`,
related links to home and the zombie page, `status: "draft"` until the R2/R3 sample films pass, then published in the "opening soon"
state (§5a). Draft pages are not linked or indexed (existing rule). Sitemap, hreflang, OG image and JSON-LD
come from the existing page machinery.

## 5a. Release order (decided with the owner)

- **The Christmas page goes up early.** As soon as the R2/R3 sample films pass, `/ai-christmas-video`
  is published and indexable in an **"opening soon" state**: samples, beats, how it works, FAQ and
  privacy as in §5, but the upload tool is replaced by an "Opening soon" panel with **no price**
  (the pack is not on sale yet) and no email capture. When `christmas1` goes on sale and a scene
  is `live`, the panel becomes the real tool — same URL, same content.
  Why: the owner chose indexing time over waiting; the December window is the goal.
- **The home redesign ships in the same release as the early Christmas page** (my call, the owner
  did not object): first screen features Christmas, film wall shows Christmas tiles. Every
  site-wide "make a film" link that points at `/#make` today (header Make button, photo-tool and
  blog CTAs, the post-checkout return path) moves to **the featured story's page while its tool is
  open, otherwise the zombie page**. Until Christmas opens, the hero button says "See the
  Christmas film" rather than "Make".
- Ownership: flipping scenes `live: true`, the privacy-policy update and the Stripe price stay on
  the Christmas content plan's launch checklist; this plan consumes those switches.

## 6. Samples (decided: real-user-style films)

- The films shown are the **R2/R3 staging films** from the Christmas content plan (Task 12): made
  through the real pipeline from **AI-generated eval personas**, not customers. That gives one film
  per scene — exactly what §4 and §5 need. The owner picks which one is the hero.
- Each sample keeps the existing "AI example: …" alt text convention.
- Encode like the existing samples: full film plus a short silent loop and a poster frame under
  `apps/web/public/samples/films/`.

## 7. What exists and what changes (for the builder)

- `HomePage.astro` serves both `home` and `landing` kinds (`variant`). The home layout changes as
  in §4; the landing variant gains the Christmas content blocks in §5. Whether that is one template
  with story-driven sections or a separate template is the builder's call.
- `StoryTool` today only knows the zombie story; `preset` covers `kind` and `scene`. It needs a
  **story preset** (and to show only that story's live scenes and price). The API already accepts
  `story` on create (`apps/api/src/routes/stories.ts`).
- `SAMPLE_FILMS` / `samples.ts` need a story field so the wall can group and filter.
- `packages/catalog/src/pages.ts`: new page, new H1 for home, `preset.story`, `FEATURED`.
- Tests first (project rule): catalog tests for `FEATURED` resolution (date windows, fallback,
  only live stories), page tests for the new entry (draft until live, never linked while draft),
  web tests that no number on the new pages is hard-coded.

## 8. Cost

- **Build:** engineering time only; no new services. Static assets on the existing Cloudflare
  hosting (no per-request cost for the samples).
- **Sample films:** already budgeted in the Christmas content plan (R2/R3 ≈ $8 each on staging);
  this design adds **no extra generation spend**. Encoding loops/posters is local.
- **SEO data:** 哥飞 toolbox credits — 13 used for this design; a recheck before launch ≈ 10.
- **Page weight (the real cost risk):** the film wall must not load seven videos up front. Tiles
  show posters; loops load and play only when on screen (IntersectionObserver), `preload="none"`,
  loops ≤ ~200 KB like the existing ones. Home LCP stays the hero poster.
- **Running cost of the switch:** none beyond a rebuild.

## 9. Security and compliance

- **Who is on screen:** only AI-generated personas from the eval set. No customer film is ever used
  as a sample without a separate, explicit opt-in flow (not part of this design).
- **Privacy policy must be updated before the Christmas page goes live**: the `describe` step
  sends photos to Anthropic (Haiku) and Google (Gemini fallback) via KIE; these processors must be
  listed (already a launch blocker in the content plan's ledger).
- **Truthful claims:** price, seconds, credits and deletion window come from `packages/catalog`;
  no "free" or unverifiable claims. The sample films are labelled as AI examples.
- **Payments:** the Christmas product checks out through Stripe Managed Payments on the
  VideoZombieCouple account only; `christmas1` goes on sale only when a scene is live (existing
  catalog rule). No sharing of ad/analytics/payment accounts with UnblurPix or video2mp4.
- **Staging-only switches** (`PREVIEW_SCENES`) must not appear in production config.
- **Trademark/wording:** "Christmas" is generic; no third-party brands or characters (e.g. no
  Santa likenesses from films, no song lyrics) in copy or samples.

## 10. Later opportunity (not in this design)

**AI Christmas photo** (74,000 US searches in December, KD 41 with a DR 7 site in the top ten).
The pipeline already produces Christmas keyframes; a cheap photo product or a free teaser could
capture this. Needs its own pricing, page and eval — a separate decision.

## 11. Left to the builder

- Template structure (§7), component names, CSS within the existing design system
  (`docs/design/`).
- Exact copy beyond the H1s and the decisions above (English, plain, no hype).
- How the featured switch gets rebuilt on its date.
