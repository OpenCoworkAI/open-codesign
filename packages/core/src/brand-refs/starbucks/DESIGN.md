---
name: Starbucks
slug: starbucks
category: Retail
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Starbucks. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#006241"
  secondary: "#1E3932"
  background: "#FFFFFF"
  surface: "#F2F0EB"
  text: "#1E3932"
  muted: "#6E6E6E"
  border: "#D4D4D4"
  accent: "#D4E9E2"
  brandGreen: "#006241"
  housGreen: "#00754A"
  warmGold: "#CBA258"
  rewardsPurple: "#86072C"

typography:
  display:
    fontFamily: "SoDo Sans, Lander, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "SoDo Sans, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.06)"
  md: "0 8px 24px rgba(0,0,0,0.10)"
  lg: "0 24px 48px rgba(0,0,0,0.14)"

motion:
  duration:
    fast: "150ms"
    normal: "250ms"
    slow: "400ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Starbucks balances heritage with friendliness. The brand color is the deep house green (`#006241`), warmed by an ivory canvas (`#F2F0EB`) and a small palette of warm accents (gold, plum, soft mint). The aesthetic is editorial-meets-friendly: large sip-photography of drinks, hand-drawn illustration accents (the famous winter snowflakes, fall leaves), bold rounded sans headlines.

The mobile app is the modern face of the brand — rewards-driven, dense product cards, friendly micro-illustrations.

## Color Palette & Roles

- `primary` (`#006241`) — house green; brand wordmark, primary CTAs, header chrome.
- `secondary` (`#1E3932`) — deep forest green; primary text, dark hero bands.
- `background` (`#FFFFFF`) — white in default surface.
- `surface` (`#F2F0EB`) — ivory section bands; the "warm" canvas tone.
- `text` (`#1E3932`) — primary copy in deep green-black; rarely pure black.
- `muted` (`#6E6E6E`) — secondary copy.
- `border` (`#D4D4D4`) — hairline.
- `accent` (`#D4E9E2`) — soft mint; light backgrounds for callouts.
- `warmGold` (`#CBA258`) — Reserve / premium accents.
- `rewardsPurple` (`#86072C`) — Rewards loyalty program accents (deep claret).

## Typography

SoDo Sans (custom, by House Industries / Plau) is the brand face — friendly geometric sans. Display weight 700, modest tracking (-0.01em), 1.1 line-height. Body weight 400, 1.55 line-height. Helvetica Neue is the safe fallback.

Hierarchy: hero (40-64 px) → section (24-32 px) → body (16-18 px) → caption (13-14 px). The brand uses comfortable, medium-large type — neither tiny nor monumental.

## Components

- **Buttons**: pill-shaped (rounded-full), 40-48 px height, generous padding. Primary: solid house green with white text, no border, no shadow.
- **Drink cards**: rounded (8-16 px) cards anchored on a centered photo of the beverage with name, price, and customization meta below.
- **Promo banners**: full-bleed bands on `surface` (ivory) or seasonal accent colors with editorial illustration.
- **Inputs**: 44-48 px height, 8 px radius, 1 px `border` brightening on focus.
- **Stars / rewards**: deep gold or claret pill chips with icon + count.

## Layout

12-column grid, max width ~1240 px. Section padding 48-96 px. The marketing site reads like a magazine — alternating image-led and copy-led bands. The mobile app is dense — drink grids, sticky bottom Order/Pay nav, and prominent rewards header.

## Depth & Elevation

The brand is gently rounded but mostly flat. Cards lift on hover with `sm` shadow; modal sheets use `md` shadow. The rewards card visualization uses depth (soft drop shadow, slight gradient) to feel like a physical object. Drink photography supplies most of the visual richness.

## Do's & Don'ts

**Do**
- Anchor on house green (`#006241`) with the warm ivory `#F2F0EB` canvas.
- Use SoDo Sans (or Helvetica Neue) at weight 700 for headlines, modest size (40-64 px).
- Lead drink-focused pages with centered top-down beverage photography.
- Use pill CTAs in solid house green; one primary action per band.
- Reserve gold for Reserve / premium contexts; claret for the Rewards program.

**Don't**
- Use pure black for text — `#1E3932` is the brand text color.
- Use a cool gray neutral; the brand canvas is warm ivory.
- Decorate with gradients on UI chrome (rewards card is the exception).
- Cluster competing accent colors; pick one beyond the green.
- Square the corners of CTAs; the brand is rounded.

## Responsive Behavior

Below 960 px the marketing alternation collapses to a single column. Hero headlines drop from ~64 px to ~32 px; section padding from 96 to 48 px. The mobile app is mobile-native — drink grids reflow 2-up to 1-up, the bottom nav remains sticky with Order / Pay / Stores tabs. Rewards header stays prominent at every breakpoint.

## Agent Prompt Guide

When asked to design "in the style of Starbucks":
1. Anchor on the house green (`#006241`) with a warm ivory `#F2F0EB` canvas.
2. Set headlines in SoDo Sans or Helvetica Neue at weight 700, 40-64 px, modest tracking.
3. Lead with centered top-down beverage photography on white or ivory bands.
4. Use pill primary CTAs in solid green with white text — one per band.
5. Reserve gold for premium contexts and claret for the Rewards loyalty program.

---
*Inspired by Starbucks. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
