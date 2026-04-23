---
name: Mistral
slug: mistral
category: AI
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Mistral. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#FA520F"
  secondary: "#FFCD43"
  background: "#FAF7F2"
  surface: "#FFFFFF"
  text: "#0F0E0E"
  muted: "#5C5A55"
  border: "#E5E0D8"
  accent: "#FA520F"
  yellow: "#FFCD43"
  amber: "#FFA500"
  ember: "#E84A1A"
  flameRed: "#C8210C"

typography:
  display:
    fontFamily: "GT America, Inter, system-ui, sans-serif"
    weight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.04)"
  md: "0 8px 24px rgba(0,0,0,0.08)"
  lg: "0 24px 48px rgba(0,0,0,0.12)"

motion:
  duration:
    fast: "120ms"
    normal: "200ms"
    slow: "320ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Mistral leans into its name — the brand colors are flame: yellow, amber, ember, deep red — laid against a warm cream background that reads almost like paper. The brand identity is distinctively French: editorial, type-led, slightly serious, with the recognizable "wind" gradient logo as the consistent visual anchor.

Marketing pages feel like an academic publication that happens to ship code — long-form copy, restrained chrome, the flame gradient appearing on hero illustrations.

## Color Palette & Roles

- `primary` (`#FA520F`) — the dominant flame-orange; primary CTAs, brand accents.
- `secondary` (`#FFCD43`) — flame-yellow; gradient companion.
- `background` (`#FAF7F2`) — warm cream paper; the brand canvas.
- `surface` (`#FFFFFF`) — pure white card on cream.
- `text` (`#0F0E0E`) — near-black.
- `border` (`#E5E0D8`) — warm hairline that matches the cream background.
- The flame gradient: `yellow` → `amber` → `ember` → `flameRed`, used on the logo and hero illustrations.

## Typography

GT America (or Inter as fallback) at weight 500 for display — Mistral, like Cursor and Runway, deliberately avoids bold weights. Display tracking -0.02em, line-height 1.1. Body is Inter 400, 1.55 line-height. Mono (JetBrains Mono) appears in code samples and model identifiers.

Hierarchy uses scale: hero (56-72 px) → section (32-40 px) → body (16 px) → caption (13 px).

## Components

- **Buttons**: 36-44 px height, 4-8 px radius. Primary: solid flame-orange with white text, no border, no shadow. Secondary: transparent with 1 px border, `text` color.
- **Cards**: white on cream, 8-12 px radius, 1 px hairline border, subtle `sm` shadow on hover.
- **Inputs**: 40 px height, 6 px radius, 1 px `border`.
- **Code blocks**: light cream background slightly darker than canvas, mono font, syntax highlighting using the flame palette for accent tokens.
- **Tags / chips**: rounded-full with `surface` background, 1 px border.

## Layout

12-column grid, max content width ~1200 px. Section padding 96-128 px on marketing. Layouts feel editorial — long single-column reading sections punctuated by code samples and small product diagrams.

## Depth & Elevation

The brand is essentially flat. Cards lift on hover with a subtle `sm` shadow. The flame gradient on hero illustrations is the only "depth" — it implies warmth and motion. No glassmorphism, no neon glows.

## Do's & Don'ts

**Do**
- Use the warm cream `#FAF7F2` background; pure white feels too sterile.
- Reserve the flame gradient for the logo and one hero illustration per page.
- Set display in GT America or Inter at weight 500; never bolder.
- Treat code blocks as editorial figures, syntax-highlighted with flame accents.
- Keep chrome flat — hairline borders, soft hover lifts only.

**Don't**
- Use a cool gray background — the brand is warm.
- Apply the flame gradient to UI chrome (buttons, cards).
- Use a bold (700+) display weight.
- Stack multiple competing accent colors; flame-orange does the job.
- Add drop shadows to inline content.

## Responsive Behavior

Below 960 px the editorial single-column layout stays single-column with reduced side padding (24 px). Hero headlines drop from ~72 px to ~36 px. Section padding compresses from 128 to 64 px. Code blocks become horizontally scrollable rather than wrapping.

## Agent Prompt Guide

When asked to design "in the style of Mistral":
1. Anchor on warm cream `#FAF7F2` background with near-black `#0F0E0E` text.
2. Use flame-orange (`#FA520F`) as the primary accent; the yellow→red flame gradient only on the hero illustration.
3. Set type in GT America or Inter at weight 500, tight tracking, never bolder than 500.
4. Build editorial single-column layouts with code blocks as figures.
5. Keep chrome flat — hairline borders, no shadows on default state.

---
*Inspired by Mistral. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
