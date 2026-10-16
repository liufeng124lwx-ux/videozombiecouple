# 50 Christmases — 即梦 findings (Seedream 5.0 Pro, 2026-10-15)

Personas: p01 (young East Asian couple), p03 (young white couple), AI-synthetic.

1. wide (refs: survivor photo, forgetting photo) — v1 draft works for both couples: cabin, armchair, plaid blanket, two white mugs, navy sweater / cream cardigan. Aged faces keep face shape and hairline.
2. forgetCold v1 (refs: forgetting photo + wide): FAILS — clothes copied from the young photo (green sweater), medium shot not close-up, and one of two runs turned her into an old MAN.
   v2 ("take the face only from IMAGE 1 … take the clothes, the room and the light only from IMAGE 2 … never the clothes from IMAGE 1", "tight head-and-shoulders close-up"): WORKS — cream cardigan, tight close-up, recognisably her, empty gaze. Hook frame viable.
3. rememberClose v2 (same wording, refs: survivor photo + wide): 1 of 2 runs turned him into a WOMAN (wide shot has two people → identity confusion).
   v3 (refs: young photo ONLY; clothes + setting in text; "the same gender … as IMAGE 1"): both runs correct gender and clothes; likeness moderate; smile not sad enough.

Rules so far
- Any keyframe that references a two-person frame must say which image gives the face and which gives clothes/room/light.
- Close-ups of one person: reference only that person's photo; describe clothes/room in text; say "the same gender as IMAGE 1".
- Production: make close-up keyframes candidates: 2 + face scoring, so a gender-swapped candidate loses (≈ +$0.03/film).
4. memory v2 (refs: survivor, forgetting, ornament; "face, hair, age and gender exactly as in IMAGE n"): WORKS — both recognisable, hand on cheek, same heart on tree, mugs, boxes, golden light.
5. forgetWarm v1 (refs: forgetting photo + forgetCold result): WORKS — same framing, warm light, tears; gaze still toward window (leave the turn to the shot).
6. tree v2 (refs: survivor, forgetting, wide, ornament; per-person face source + "same gender as IMAGE n"): WORKS — no swap; one of two runs had two hearts.
7. embrace v2 (refs: survivor, forgetting, tree): WORKS — foreheads, hand on cheek, lit tree, dawn; one run filled the tree with many hearts → add "only this one heart ornament on the tree".
Gate (10/22: aged faces recognisable) — passed on p03 in Seedream. Still to do: same set on p01/p06/p07 (skin tones, hijab, bald), then the real pipeline on staging (gpt-image-2).
8. CONTAMINATION: 即梦 runs inside a "conversation"; later runs drift toward earlier results (p06 wide in the p03 conversation came out as the p03 couple: hijab and beard gone). Start a NEW conversation for every test (go.sh does it now). Earlier p03 results came after p01 in one conversation — re-check them fresh before trusting likeness.
9. wide v2 (fresh conversation; "keeps the exact face shape, features, skin tone, gender and ethnicity … any head covering, beard or hairstyle, only greyer and older"): p06 identity kept (hijab, beard, skin tone) but looked ~55–60.
   wide v3 (+ "late seventies, unmistakably elderly: white hair, white beard if they have one, deep wrinkles … sagging skin, age spots, thin hands", "fifty years older"): p06 aged correctly AND recognisable. The forgetting person still turns toward the other one in 1–2 runs → "eyes fixed on the window" needed.
   Do NOT write "silver-white hair … same hairline": it erases head coverings.
10. Generic wording cannot serve both kinds of people (all runs in fresh conversations):
    - v3 "keeps any head covering, white beard if they have one" → p06 OK, but p03 got a headscarf and a beard.
    - v4 "their own hairstyle and facial hair … only turned grey or white — never add or remove a beard, a head covering or glasses" → p03 OK, p06 lost hijab and beard (became a different, paler couple).
    - v5 = v4 without the generic clause + explicit per-photo lines ("IMAGE 2 wears a blue floral headscarf that covers all of her hair — keep it. IMAGE 1 has a full beard, now white.") → p06 OK: hijab, white beard, aged, recognisable; one run looked out of the window.
    => DESIGN CHANGE for plan 2: a "describe" step before keyframes — a cheap vision model writes one line per photo (head covering, facial hair, hairstyle, glasses; never guesses gender words beyond what's visible), injected into every keyframe prompt that ages or redraws a person. Cost ≈ $0.001–0.01/film. Without it, hijab/beard wearers (or clean-shaven, uncovered people) come out wrong.
