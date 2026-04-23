---
name: Framer
slug: framer
category: Design Tools
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Framer. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#0099FF"
  secondary: "#000000"
  background: "#FFFFFF"
  surface: "#F3F3F3"
  text: "#0F0F0F"
  muted: "#6B6B6B"
  border: "#E6E6E6"
  accent: "#0099FF"
  brandBlack: "#000000"

typography:
  display:
    fontFamily: "Inter Display, Inter, system-ui, sans-serif"
    weight: 700
    lineHeight: 1.0
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.4
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192]

radius:
  none: "0"
  sm: "6px"
  md: "12px"
  lg: "20px"
  xl: "32px"
  full: "9999px"

shadows:
  sm: "0 2px 8px rgba(0,0,0,0.04)"
  md: "0 12px 36px rgba(0,0,0,0.08)"
  lg: "0 32px 72px rgba(0,0,0,0.16)"

motion:
  duration:
    fast: "200ms"
    normal: "400ms"
    slow: "700ms"
  easing:
    standard: "cubic-bezier(0.25, 0.1, 0.25, 1)"
    spring: "cubic-bezier(0.34, 1.56, 0.64, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Framer is the website-builder for animation enthusiasts, and the marketing site never lets you forget it. Almost every element on the page moves — text scrambles in, cards lift on scroll, gradients drift. The aesthetic is large-display-typographic with enormous hero headlines (often 120-160 px), generous rounded corners (20-32 px), and an ultra-bright "Framer blue" accent.

The page feels like a Pinterest moodboard staged with motion design.

## Color Palette & Roles

- `primary` (`#0099FF`) — bright Framer blue; primary CTAs and link color.
- `text` (`#0F0F0F`) — near-black; primary copy.
- `background` (`#FFFFFF`) — white in light mode; pure black in dark mode.
- `surface` (`#F3F3F3`) — pale gray section bands.
- `muted` (`#6B6B6B`) — secondary copy.
- `border` (`#E6E6E6`) — hairline.

Beyond these, Framer uses gradient fills (often blue → purple or blue → cyan) and color from product mockup screenshots. The static palette stays intentionally small.

## Typography

Inter (Inter Display for hero copy) at weight 700, very tight tracking (-0.04em), 1.0 line-height. Hero headlines are massive — often 120-160 px on desktop, taking up most of the viewport. Body text is Inter 400, 1.4 line-height.

The brand loves all-caps eyebrow labels above sections (12-13 px, tracked +0.05em). Numerals are tabular in pricing tables.

## Components

- **Buttons**: pill or large-radius (20-32 px) with the bright blue fill and white text. Heights are generous (44-56 px) with substantial horizontal padding. No border, soft shadow on hover.
- **Cards**: large radius (20-32 px), white on `surface`, soft `md` shadow, often with a video preview or animated mockup inside.
- **Inputs**: 44-48 px height, large radius (12 px), 1 px border that brightens on focus.
- **Tabs**: pill-shaped tab list with a moving background indicator.
- **Animated text**: scramble/typewriter reveals on hero headlines; words slide in on scroll.

## Layout

12-column grid, max width ~1200 px, but section bands frequently break out full-bleed. Section padding is generous (96-192 px). Hero sections are intentionally tall — often a full viewport. Long marketing pages alternate light and dark bands with parallax product mockups between.

## Depth & Elevation

The brand leans on motion for depth more than shadow. Cards lift gently on scroll-into-view; floating mockups rotate slightly in 3D. Drop shadows are soft and long. Dark mode introduces glow effects on cards. Glassmorphism makes occasional appearances on the navigation bar.

## Do's & Don'ts

**Do**
- Animate something — scroll reveals, hover lifts, scramble text, gradient drift.
- Use enormous hero headlines (120-160 px on desktop) at weight 700 with tight tracking.
- Apply large rounded corners (20-32 px) on cards and primary buttons.
- Pair Framer blue CTAs with subtle gradients (blue → purple) on hero accents.
- Use all-caps tracked eyebrow labels above section headlines.

**Don't**
- Ship a static page; Framer is a motion brand.
- Use small (≤4 px) corner radii on chrome — the brand is rounded.
- Cluster many CTAs; one or two primary actions per band.
- Use serif type — the brand is geometric sans.
- Underuse white space — section padding is generous.

## Responsive Behavior

Below 960 px hero headlines drop from ~160 px to ~56 px and section padding compresses from 192 to 64 px. Multi-column feature grids reflow to a single column with cards stacking vertically. Animated reveals trigger on scroll position rather than viewport entry to feel snappier on mobile. Large-radius cards retain their corners regardless of size.

## Agent Prompt Guide

When asked to design "in the style of Framer":
1. Lead with an enormous hero headline (120-160 px, weight 700, -0.04em tracking).
2. Use Framer blue (`#0099FF`) primary CTAs — pill or large-radius (20-32 px), generous padding, no border.
3. Build cards with 20-32 px radii and soft long shadows; embed video or animated mockups inside.
4. Add motion — at minimum a scroll-reveal fade and a hover-lift; ideally a scramble or typewriter on the hero.
5. Use generous vertical padding (96-192 px) and break sections full-bleed when they need atmosphere.

---
*Inspired by Framer. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
