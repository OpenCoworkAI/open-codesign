---
name: Runway
slug: runwayml
category: AI
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Runway. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#FFFFFF"
  secondary: "#000000"
  background: "#000000"
  surface: "#0E0E0E"
  surfaceRaised: "#1A1A1A"
  text: "#F5F5F5"
  muted: "#7A7A7A"
  border: "#222222"
  accent: "#FFFFFF"

typography:
  display:
    fontFamily: "Söhne, GT America, Inter, system-ui, sans-serif"
    weight: 500
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Söhne, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "Söhne Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "2px"
  md: "4px"
  lg: "8px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.40)"
  md: "0 8px 24px rgba(0,0,0,0.50)"
  lg: "0 24px 60px rgba(0,0,0,0.60)"

motion:
  duration:
    fast: "120ms"
    normal: "240ms"
    slow: "480ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Runway is a creative-tools company that wears the look of an art-house film studio. The marketing surface is pure black, type-driven, and laden with autoplaying generated video clips — the videos are the design. Chrome is reduced to almost nothing: thin top nav, white text, a single white pill CTA. The brand reads more "MoMA" than "SaaS".

The product editor is also dark, with a horizontal timeline at the bottom and an inspector panel at right — a video editor's spatial logic.

## Color Palette & Roles

- `primary` (`#FFFFFF`) — white; primary CTA fill, hero text.
- `background` (`#000000`) — pure black canvas.
- `surface` (`#0E0E0E`) — section bands and editor panels.
- `surfaceRaised` (`#1A1A1A`) — cards, modals, hover states.
- `text` (`#F5F5F5`) — body copy on dark.
- `muted` (`#7A7A7A`) — secondary copy.
- `border` (`#222222`) — hairline.

The brand intentionally has no chromatic accent — the generated videos themselves provide all the color and energy.

## Typography

Söhne (Klim Type Foundry) is the brand face — a neutral grotesk with subtle warmth. Display weight 500 (not 700, the brand avoids bolds), tight tracking (-0.025em). Body weight 400 with comfortable 1.5 line-height.

Hierarchy uses scale and weight: hero (64-96 px) → section (32-40 px) → body (16 px) → caption/mono (13 px). Mono appears for model names ("Gen-3 Alpha"), version strings, parameters.

## Components

- **Buttons**: 36-44 px height, 4 px radius (small radii are signature — 4 px max). Primary: solid white background, black text, no border. Secondary: transparent with 1 px white border at low alpha.
- **Video tiles**: full-bleed autoplaying clips with no border, no shadow, just a subtle hover scale.
- **Inputs**: 36 px height, 2 px radius, 1 px `border`, brightens on focus.
- **Tabs**: text only with subtle bottom underline.
- **Badges**: tiny mono labels in `muted`, no background.

## Layout

Marketing pages stack full-bleed video bands separated by short type-only sections. Max content width on type sections is ~1200 px. Section padding 96-128 px. The editor uses a desktop video editor layout: top toolbar, left media library, center preview, right inspector, bottom timeline.

## Depth & Elevation

The brand is flat and dark. Elevation comes from video content "cutting through" the page rather than from shadow. Modals use soft `md` shadow on a dimmed backdrop. Editor panels are separated by 1 px `border` only — no internal shadows.

## Do's & Don'ts

**Do**
- Lead with autoplaying generated video as the hero element.
- Default to pure black background with white type.
- Use Söhne (or Inter) at weight 500 for display — never bold.
- Keep corner radii small (≤ 4 px) on chrome.
- Treat the video clips as the design — chrome should disappear around them.

**Don't**
- Add chromatic accents — the brand is monochrome.
- Use rounded corners larger than 8 px on chrome.
- Decorate with gradients, glows, or color washes.
- Cluster multiple CTAs; one white pill is enough.
- Show the editor in marketing mockups; show the output (video) instead.

## Responsive Behavior

Below ~960 px the multi-column video grids stack vertically and autoplay only the in-viewport clip to preserve bandwidth. Hero headlines drop from ~96 px to ~36 px; section padding from 128 to 64 px. The editor itself is desktop-only; mobile users land on a "view-only" experience.

## Agent Prompt Guide

When asked to design "in the style of Runway":
1. Build pure black with white type. No accent color — generated video supplies all chromatic energy.
2. Lead the page with one full-bleed autoplaying video clip; chrome around it should be invisible.
3. Set type in Söhne (or Inter) at weight 500, tight tracking, no bolds.
4. Keep corner radii tiny (2-4 px) on inputs, small (4 px) on buttons.
5. Use a single white pill CTA, black text, no border, no shadow.

---
*Inspired by Runway. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
