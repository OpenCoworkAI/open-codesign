---
schemaVersion: 1
name: frontend-design-anti-slop
description: >
  Creates distinctive, production-grade frontend interfaces with exceptional
  design quality. Use when building any UI component, landing page, dashboard,
  prototype, or when styling HTML/CSS. Avoids generic AI aesthetics (Inter font,
  purple gradients, predictable card layouts).
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Frontend Design Quality Guard

You tend to produce "AI slop" by default: Inter or system fonts, purple-on-white gradients, symmetric card grids, flat white backgrounds. Break this pattern deliberately.

### Typography
Choose unexpected, characterful typefaces. Pair a distinctive display font (e.g. Playfair Display, DM Serif Display, Syne, Bebas Neue, Instrument Serif) with a refined body font. Never use Inter, Roboto, Arial, or Space Grotesk — they signal zero creative investment.

### Color & Theme
Commit fully to one coherent aesthetic. Use CSS custom properties for every color token. Dominant accent colors with sharp contrast outperform timid palettes. Avoid purple gradients on white backgrounds — they are the single most recognizable AI default. Try: deep navy + warm amber, charcoal + acid green, cream + burgundy + gold, near-black + electric cyan.

Express colors in `oklch()` where possible — it gives perceptually uniform lightness steps and vivid gamut-P3 hues without the muddy mid-tones of hex-RGB.

### Motion
CSS-only for HTML artifacts. One well-orchestrated page-load with staggered `animation-delay` reveals is better than scattered micro-interactions. Use `@media (prefers-reduced-motion: reduce)` to gate all animations.

### Spatial Composition
Asymmetry. Overlap. Diagonal rhythm. Grid-breaking hero elements. Resist the urge to center-align everything — left-aligned, offset, or deliberately edge-bleeding layouts feel more crafted.

### Backgrounds
Never solid white or solid grey. Use CSS gradients, noise/grain overlay (`background-image: url("data:image/svg+xml,...")`), geometric SVG patterns, or subtle radial glows. One grain overlay (`opacity: 0.04`) on a colored background immediately elevates perceived quality.

### Tone Commitment
Pick **one** tone and execute it with full craft: brutally minimal / maximalist chaos / retro-futuristic / organic warmth / luxury editorial / bold experimental. Do not hedge between styles — half-committed aesthetics look worse than any single extreme.

### Hard Prohibitions
NEVER use: Inter, Roboto, Arial, system-ui, Space Grotesk as the primary typeface; purple gradients on white; symmetric 3-column card grids as the only layout element; drop shadows that look like Bootstrap defaults; placeholder grey rectangles as "images".
