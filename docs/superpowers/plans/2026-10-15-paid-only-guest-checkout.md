# Paid-only stories, guest checkout, tiered retention — Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:executing-plans. Steps are RED → GREEN.

**Goal:** No free generation at all. Visitors see finished example films, upload two photos (checked for one adult face each, on our own container), pay, and get the film. Buying works without signing up. Films are kept 3 days for unverified buyers and 30 days for verified accounts; photos and keyframes are always deleted within 3 days. Every paid film may be remade once for free.

**Spec:** `docs/superpowers/specs/2026-10-14-videozombiecouple-design.md` (this plan supersedes §4.1's free preview and §7's preview quota; the decisions below are the owner's, 2026-10-15).

## Decisions (owner, 2026-10-15)

1. No free preview. The examples on the page are the preview.
2. Packs can be bought without signing in: the buyer types an email before checkout; that creates an **unverified** account and signs the browser into it ("pay to register"). If the email already belongs to a verified account, the buyer signs in with an email code instead (nobody can open someone else's account by typing their address).
3. If the faces don't look right, the film can be remade once for free (while the photos still exist, i.e. within 3 days).
4. Photos and keyframes: deleted within 3 days for everyone. Films: 3 days for unverified accounts, 30 days for verified ones (email code, magic link — including the one in the film-ready email — or Google). Verifying later extends existing films to 30 days.
5. Remind early: the done screen and the film-ready email show the deletion date; one reminder email the day before deletion.

## Global constraints

- Numbers on pages come only from `packages/catalog` (CLAUDE.md).
- The photo check (`score:sources`) runs before payment and never calls a paid model.
- A guest session is an ordinary session of an unverified user; nothing else gets special-cased.
- No free model call may be triggered without a paid hold, except the one free remake per paid film.

## Tasks

### Task 1 — catalog
- `RETENTION`: `photosDays: 3`, `guestFilmDays: 3`, `memberFilmDays: 30` (replace `outputDays`), `remakesPerFilm: 1`; drop `QUOTA` preview numbers and the `preview.daily` fact; facts `retention.guestFilmDays`, `retention.memberFilmDays`, `remakes.perFilm`.
- Tests: facts; pricing cost model (no preview cost; video = 4 candidates + score + B + 5 shots).

### Task 2 — story runner
- Create runs only `score:sources`; status `previewing` → `preview_ready` keeps its name in the contract but means "photos checked, ready to make" (`preview` stays `null`).
- Render runs the whole graph: A/C candidates, `score:AC`, B, shots, compose.
- `remake()`: once per paid film while photos exist; resets every generated step, no charge.
- View: `remakeLeft`, `video.expiresAt` from the story's retention.
- Tests: create never touches kie; render generates keyframes; remake once; remake refused after photos expired.

### Task 3 — routes and accounts
- `POST /v1/stories` without a session (owner = visitor); Turnstile + rate limit stay; no quota.
- `POST /v1/auth/guest {email}`: unknown email → create unverified user, move the visitor's stories to it, start a session; unverified existing user with no verified login → same; verified user → `LOGIN_REQUIRED` (the client opens the code sign-in).
- `POST /v1/stories/:id/remake`.
- Verification (code, link, Google) sets `email_verified_at` and extends the user's done stories to 30 days.
- Tests for each, including "typing a verified user's email never signs you in".

### Task 4 — retention and reminders
- `expires_at` on done = finish + (verified ? 30 : 3) days; `retention` column (`guest` | `member`) via migration 0007.
- `infra/r2-lifecycle.json`: `in/` 1 d, `keep/` `kf/` 3 d, `shot/` `out/` 31 d (cleanup deletes earlier per story).
- Film-ready email: deletion date, and for unverified accounts a sign-in link that keeps the film 30 days. Daily cron: reminder the day before deletion.
- Tests: expiry by verification; extension; reminder sent once.

### Task 5 — web
- Tool: photos → check → "Make my film" (guest: email field then checkout; signed in with credits: render) → rendering → done (deletion date banner, Download, one free remake, title change).
- Copy: remove every "free preview" claim (home, landing, pet, pricing, FAQ, llms.txt, privacy, terms, refund); explain the free remake and the retention.
- Tests: StoryTool flows; e2e updated; check-dist.

### Task 6 — verify and ship to staging
- All suites, `verify`, e2e; deploy staging; one sandbox guest purchase end to end (email → Waffo test card → film → remake).

## Review focus
1. A guest typing someone else's verified email never gets their session or credits.
2. No path creates a kie job without a paid hold (except the single remake).
3. Remake after photos are gone fails cleanly, without charging or hanging.
4. Films of unverified buyers really disappear after 3 days, and verification extends them.
5. Concurrent guest checkouts from two tabs don't create two accounts for one email.
