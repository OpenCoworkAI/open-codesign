---
schemaVersion: 1
name: pitch-deck
description: >
  Designs polished pitch deck slides and presentation layouts. Use when the
  user asks for a slide deck, investor pitch, presentation, or multi-slide
  narrative. Enforces slide structure, whitespace discipline, and one-claim-per-slide rule.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Pitch Deck Design Principles

### One Claim Per Slide
Every slide communicates exactly one idea. If you find yourself writing "and also..." you need two slides. The claim should be expressible in a single sentence of ≤ 12 words placed at the top of the slide.

### Typographic Hierarchy
Use a 3-tier scale: headline (56–72px), supporting statement (24–32px), body/caption (14–16px). Never mix more than two font families. Display font for headlines; neutral font for body. Tight letter-spacing (−0.02em to −0.04em) on large headlines reads as confidence.

### Whitespace as Signal
Leave at least 20% of each slide empty. Crowded slides signal a presenter who does not trust the audience. Generous margins (8–12% of slide width) and vertical padding between elements are non-negotiable.

### Slide Ratio and Dimensions
Default to 16:9 (1920×1080px or 1280×720px). Avoid 4:3 — it looks dated. For mobile-first contexts (scrollable deck on phone) use 9:16.

### Data Slides
Every chart needs: a headline that states the insight (not just the metric), axis labels in the same font as the slide body, and a clear color key. Never use 3-D charts or pie charts with more than 4 segments. Bar charts and area charts read fastest. Use a single accent color for the data series you want the audience to notice; grey out the rest.

### Color Discipline
Limit the palette to 3 colors: background, text, and one accent. If you need a second accent, make it a tint of the first. Every slide in the deck shares the same palette — do not introduce new colors mid-deck.

### Opening and Closing Slides
The opening slide must make the problem viscerally clear in under 5 seconds of reading. The closing slide must state the single desired action (invest, partner, join) with contact information — not a generic "Thank you" or "Q&A".

### Narrative Arc
Structure: Problem → Insight → Solution → Evidence → Ask. Each section should be 1–3 slides. Do not spend more than 25% of the deck on product features.
