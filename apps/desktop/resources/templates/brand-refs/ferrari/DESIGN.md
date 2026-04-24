---
name: Ferrari
slug: ferrari
category: Luxury
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Ferrari. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#DA291C"
  secondary: "#000000"
  background: "#000000"
  surface: "#0E0E0E"
  surfaceLight: "#FFFFFF"
  text: "#FFFFFF"
  muted: "#9A9A9A"
  border: "#1F1F1F"
  accent: "#DA291C"
  yellowShield: "#FFCC00"

typography:
  display:
    fontFamily: "Ferrari Sans, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Ferrari Sans, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 16, 24, 32, 48, 64, 96, 128, 192]

radius:
  none: "0"
  sm: "0"
  md: "0"
  lg: "2px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.40)"
  md: "0 8px 24px rgba(0,0,0,0.50)"
  lg: "0 24px 60px rgba(0,0,0,0.70)"

motion:
  duration:
    fast: "150ms"
    normal: "320ms"
    slow: "600ms"
  easing:
    standard: "cubic-bezier(0.25, 0.1, 0.25, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Ferrari.com is automotive cinema. Hero bands are full-bleed cinematic video or photography of cars in motion against backdrops of black canvas, sometimes scored to engine audio. Type is reserved and editorial — Ferrari Sans (an industrial sans-serif) at modest sizes, almost always white on black or black on white. The brand red appears sparingly: the prancing horse shield, a single CTA underline, the occasional rule.

The brand reads ceremonial: black canvases, slow video pans, generous space, no decoration.

## Color Palette & Roles

- `primary` (`#DA291C`) — Rosso Corsa; the historic Ferrari racing red. Used on the shield, primary CTAs, and rare accent rules.
- `background` (`#000000`) — black; the dominant marketing canvas.
- `surface` (`#0E0E0E`) — section bands.
- `surfaceLight` (`#FFFFFF`) — alternate light bands for editorial sections.
- `text` (`#FFFFFF`) — primary copy on dark; near-black on light.
- `muted` (`#9A9A9A`) — secondary copy.
- `border` (`#1F1F1F`) — hairline.
- `yellowShield` (`#FFCC00`) — the yellow background of the prancing horse shield; never a UI fill.

## Typography

Ferrari Sans (custom) is the brand face. Display weight 700, modest tracking (-0.01em), 1.05 line-height. Body weight 400, 1.5 line-height. Helvetica Neue is the safe fallback.

Hierarchy is restrained — hero (48-72 px, the brand rarely goes massive) → eyebrow (12 px uppercase tracked +0.1em) → body (16-18 px) → caption (12 px). Numerals are tabular for technical specifications.

## Components

- **Buttons**: 44-48 px height, square corners (no radius — the brand avoids rounded chrome), 1 px solid border in `text` color. Primary often shows just the label with a thin red underline as accent. Hover state inverts colors.
- **Specification tables**: dense rows with hairline dividers, label in `muted` smallcaps, value in `text` mono or proportional.
- **Hero video**: full-bleed autoplaying car footage with no overlay UI; CTA appears on scroll-out.
- **Cards**: borderless, anchored on photography with the model name and minimal meta below.
- **Inputs**: 44 px height, square corners, 1 px white border.

## Layout

Marketing pages alternate full-bleed cinematic bands (video or large photography) with constrained editorial bands (max ~960 px content column on dark or light surface). Section padding is large (96-192 px). The brand uses very few horizontal divisions per page — every section breathes.

## Depth & Elevation

The brand is essentially flat. Cinematic depth comes from photography and video — depth-of-field, lighting, motion blur. UI chrome avoids drop shadows. Elevation, when needed, is a subtle `md` shadow on modal sheets.

## Do's & Don'ts

**Do**
- Lead with full-bleed cinematic video or photography on a black canvas.
- Use Ferrari Sans (or Helvetica Neue) at weight 700, modest tracking, modest size.
- Reserve Rosso Corsa for the shield, primary CTA accents, and occasional dividers.
- Default to square corners on all chrome — the brand has no rounded grammar.
- Be generous with vertical space (96-192 px section padding).

**Don't**
- Use the brand red as a background fill for cards or buttons; it's an accent.
- Round corners on chrome — the brand is angular.
- Decorate with gradients, glows, or color washes.
- Cluster CTAs; one decisive action per hero band.
- Over-style hero typography — Ferrari hero text is restrained, not theatrical.

## Responsive Behavior

Cinematic hero bands retain their full-bleed video/photo crop at every breakpoint. Below 960 px hero text drops from ~72 px to ~32 px and section padding compresses from 192 to 64 px. Two-column technical specification tables collapse to single-column with label-above-value pairs. Square-corner geometry is preserved on mobile.

## Agent Prompt Guide

When asked to design "in the style of Ferrari":
1. Build full-bleed cinematic hero bands on a pure black canvas — large car photography or autoplaying video.
2. Set hero text in Ferrari Sans or Helvetica Neue at weight 700, modest size (48-72 px), tight tracking.
3. Reserve Rosso Corsa (`#DA291C`) for the shield and as a single accent (CTA underline, divider rule).
4. Use square corners on all chrome — buttons, cards, inputs.
5. Be generous with vertical space; let each section breathe (96-192 px padding).

---
*Inspired by Ferrari. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
