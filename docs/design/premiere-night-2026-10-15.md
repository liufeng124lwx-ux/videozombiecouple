# Premiere Night — design lock (2026-10-15)

Owner's brief: the site should feel cinematic and premium ("充满电影的质感，看起来就很高级"). Refero research (styles: 601 Inc., Liron Moran Interiors, Freshman, Sequel; screens: Runway Watch / AIFF, Sora home, Vimeo upload, Epidemic Sound, OpenAI and ElevenLabs pricing). Owner chose direction A, "Premiere Night", over "Title Sequence" and "Golden Hour".

## Thesis
The page is a screening room and the film is its only light source.

## Reference lock
- **Primary: 601 Inc.** Large dark fields, one aged-gold used only for the huge title and 1px rules, imagery framed like film stills.
- **Borrow: Liron Moran Interiors.** A giant title set behind a centred portrait image — our 9:16 film.
- **Keep from the 2026-10-14 lock:** cold night canvas, the single ember accent (primary button, progress, selection only), Archivo condensed heavy caps, Courier Prime slates, Cormorant italic only on the end-title card, 2px radii, no shadows, film grain.

## Tokens
| Token | Value | Role |
|---|---|---|
| `--void` | #07090C | the screening room (hero, gallery) |
| `--bg` | #0B0F14 | content |
| `--gilt` | #E9DFB8 | ONLY the giant title words and 1px rules |
| `--ember` | #F0A040 | ONLY primary CTA, progress, selection |
| `--spill` | per beat | light the film throws on the room (decorative) |

Spill per beat (baked, not sampled): standoff `#13263A`, embrace `#1C2633`, memory `#4A3418`, dawn `#3A3324`; 1.2 s transitions, off for reduced motion.

## Page, top to bottom
1. **Hero, 100svh, void.** The film fills the screen height, centred, no frame. The H1's first word sits left of the film and the rest right, in gilt, 160–260px, partly behind the film. Under it: the four beats as a slate line (lit in time), the CTA, one trust line. The room is lit by the film (spill). Phones: film first (≤ 72svh), the title below in one block.
2. **Casting sheet (the tool).** Two 3:4 slots labelled THE SURVIVOR / THE ONE WHO TURNS, hairlines instead of cards.
3. **Now showing.** A left rail with the slate ("NOW SHOWING · 4 FILMS"), right a horizontal row of 9:16 films that play muted in view.
4. **Ticket stubs (pricing).** Each pack is a stub: gilt hairline, perforated edge, price large.
5. Explanation, FAQ, closing title card.

## Signature
Projector spill: the hero background follows the film — cold blue, gold memory, pale dawn.

## Avoid
Gold on buttons (ember owns CTAs). Live-sampling video colour. Rounded cards. Text-on-video clutter.
