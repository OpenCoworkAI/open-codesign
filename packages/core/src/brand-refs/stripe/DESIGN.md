---
name: Stripe
slug: stripe
category: Fintech
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Stripe. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#635BFF"
  secondary: "#0A2540"
  background: "#FFFFFF"
  surface: "#F6F9FC"
  text: "#0A2540"
  muted: "#425466"
  border: "#E3E8EE"
  accent: "#00D4FF"
  highlight: "#7A73FF"
  success: "#3CB371"
  warning: "#F5A623"
  error: "#DF1B41"

typography:
  display:
    fontFamily: "Sohne, Inter, system-ui, sans-serif"
    weight: 500
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Sohne, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "-0.003em"
  mono:
    fontFamily: "Sohne Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 20, 24, 32, 48, 64, 96]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "16px"
  xl: "24px"
  full: "9999px"

shadows:
  sm: "0 2px 4px rgba(50,50,93,0.05)"
  md: "0 6px 24px rgba(50,50,93,0.10)"
  lg: "0 30px 60px rgba(50,50,93,0.18)"

motion:
  duration:
    fast: "150ms"
    normal: "240ms"
    slow: "400ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Stripe is the canonical "infrastructure looks beautiful" aesthetic. The marketing surface is famously animated — perspective-skewed multi-color gradients on the hero, parallax scroll, code blocks that look like editor screenshots. Underneath it all sits a deeply serious typographic system: Sohne, navy-on-white, ample whitespace, and code-as-art.

The dashboard product is calmer: white background, indigo accent, dense data tables, subtle shadows.

## Color Palette & Roles

- `primary` (`#635BFF`) — Stripe-indigo; primary CTAs, links, focused inputs.
- `secondary` (`#0A2540`) — deep navy; body text, headlines, footer chrome.
- `background` (`#FFFFFF`) — pure white; never off-white in light mode.
- `surface` (`#F6F9FC`) — pale blue-gray; section bands, code block surrounds.
- `muted` (`#425466`) — slate; secondary copy.
- `border` (`#E3E8EE`) — pale blue-gray; hairlines and table dividers.
- `accent` (`#00D4FF`) — cyan; appears in the famous gradient hero alongside indigo and violet.

Multi-color gradients (cyan → indigo → violet → orange) are the signature marketing motif but never appear in the product UI.

## Typography

Sohne is the brand face. Display uses 500 weight (Stripe deliberately avoids bold-bold), -0.02em tracking, line-height ~1.1. Body is 400, ~1.55 line-height. Numerals are tabular in dashboards.

Code is treated as a first-class design element: monospaced, syntax-highlighted with the brand palette, often shown on a dark navy background even within an otherwise light page.

## Components

- **Buttons**: 36 px height, 6-8 px radius. Primary: indigo background, white text, soft shadow on hover. Secondary: white with 1 px navy border. Tertiary: text-only with chevron.
- **Inputs**: 40 px height, 6 px radius, 1 px border. Focus state shows 3 px indigo halo at low alpha.
- **Cards**: 16 px radius on marketing, 8 px in product. Marketing cards lift with soft `md` shadow; product cards stay flat with hairline border.
- **Code blocks**: dark navy background (`#0A2540`), monospaced, syntax-highlighted with the brand palette.
- **Tables**: hairline rows, alternating zebra is rare; column headers in `muted` smallcaps.

## Layout

Marketing uses a 12-column grid with max content width ~1080 px and generous 96-128 px section padding. Product dashboard fits a fluid layout with a 240 px left nav. Vertical rhythm is generous on marketing (rarely under 24 px), tight in product (8-16 px increments).

## Depth & Elevation

Marketing pages are explicitly three-dimensional: parallax gradients, perspective-tilted device mockups, layered cards with soft long shadows. Product UI is the inverse — almost flat, with elevation reserved for floating menus and modals (`md` shadow at most). Never combine the two on a single surface.

## Do's & Don'ts

**Do**
- Treat code as art: dark navy background, syntax-highlighted with brand colors.
- Use the indigo→cyan→violet gradient on hero panels and decorative elements.
- Keep type weight at 500 for display; bolder feels off-brand.
- Use tabular numerals for all financial figures.
- Layer cards with soft, long, low-opacity shadows on marketing.

**Don't**
- Apply the marketing gradient inside the product UI.
- Use pure black for body copy — navy `#0A2540` is the brand text color.
- Use heavy 700+ weight for display headlines.
- Show monetary values in proportional figures.
- Add drop shadows to product UI elements; reserve them for the marketing surface.

## Responsive Behavior

At ≤ 768 px the parallax gradients flatten and the perspective device mockups rotate to portrait. Hero headlines drop from ~64 px to ~36 px; section padding compresses from 128 to 64 px. The product dashboard side nav collapses behind a top-bar menu; data tables become horizontally scrollable.

## Agent Prompt Guide

When asked to design "in the style of Stripe":
1. Pick a surface: marketing (animated, gradient-rich, perspective-tilted) or product (flat, navy-on-white, hairline borders). Don't mix.
2. Anchor on indigo `#635BFF` as the brand action color; navy `#0A2540` as the text color.
3. Use Sohne (or Inter as fallback) at weight 500 for display, never heavier.
4. Treat code blocks as featured content — dark navy background, syntax highlighted with the brand palette.
5. On marketing, layer one cyan→indigo→violet gradient at the hero; the rest of the page stays calm.

---
*Inspired by Stripe. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
