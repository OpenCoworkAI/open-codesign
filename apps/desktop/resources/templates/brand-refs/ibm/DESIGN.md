---
name: IBM
slug: ibm
category: Enterprise
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by IBM. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#0F62FE"
  secondary: "#161616"
  background: "#FFFFFF"
  surface: "#F4F4F4"
  text: "#161616"
  muted: "#525252"
  border: "#E0E0E0"
  accent: "#0F62FE"
  brandBlue90: "#001D6C"
  brandBlue70: "#0043CE"
  successGreen: "#24A148"
  errorRed: "#DA1E28"
  warningYellow: "#F1C21B"

typography:
  display:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 300
    lineHeight: 1.1
    letterSpacing: "0"
  body:
    fontFamily: "IBM Plex Sans, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "0.16px"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 8
  scale: [4, 8, 16, 24, 32, 40, 48, 64, 80, 96]

radius:
  none: "0"
  sm: "0"
  md: "0"
  lg: "0"
  full: "0"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.06)"
  md: "0 4px 12px rgba(0,0,0,0.08)"
  lg: "0 12px 32px rgba(0,0,0,0.12)"

motion:
  duration:
    fast: "110ms"
    normal: "240ms"
    slow: "400ms"
  easing:
    standard: "cubic-bezier(0.2, 0, 0.38, 0.9)"
    accelerate: "cubic-bezier(0.4, 0.14, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.38, 0.9)"
---

## Visual Theme & Atmosphere

IBM's design system (Carbon) is the canonical "calm enterprise" aesthetic. The brand color is the historic IBM blue, paired with crisp neutrals and IBM Plex (one of the most distinctive corporate typefaces in software). Marketing pages favor large editorial photography, structured grids, and the recognizable striped wordmark. The product UI (Carbon) is dense, predictable, and built for data-heavy enterprise workflows.

Type is the brand. IBM Plex carries the identity more than color does.

## Color Palette & Roles

- `primary` (`#0F62FE`) — IBM Blue 60; primary CTAs, links, focus rings.
- `brandBlue90` (`#001D6C`) — deep navy; secondary chrome, hover states.
- `brandBlue70` (`#0043CE`) — pressed state on primary.
- `text` (`#161616`) — Gray 100; primary copy.
- `background` (`#FFFFFF`) — white in light theme.
- `surface` (`#F4F4F4`) — Gray 10; section bands and form field backgrounds.
- `muted` (`#525252`) — Gray 70; secondary copy.
- `border` (`#E0E0E0`) — Gray 20; hairline.
- Status: `successGreen` `#24A148`, `errorRed` `#DA1E28`, `warningYellow` `#F1C21B`.

Carbon ships full G10/G90/G100 themes (light and dark variants); the palette above is G10.

## Typography

IBM Plex (Plex Sans for UI, Plex Serif for editorial, Plex Mono for code) is the brand. Display weight 300 (light) is a signature choice — IBM uses thin display weights to feel modern. Body weight 400, 1.5 line-height, 0.16 px letter-spacing.

Hierarchy follows Carbon's expressive type scale: display-04 (54 px) → display-01 (32 px) → heading-04 (28 px) → heading-01 (16 px) → body (14 px) → caption (12 px). Numerals are tabular for data tables.

## Components

- **Buttons**: rectangular (zero radius), 32-48 px height. Primary: solid IBM Blue 60 with white text, no border. Secondary: transparent with white text on a 1 px white border (or `text` border in light).
- **Inputs**: 40 px height, zero radius, single bottom-border that thickens on focus to IBM Blue.
- **Tables**: dense rows, hairline dividers, sortable column headers in `muted` smallcaps, mono on ID columns.
- **Tabs**: text only with 2 px bottom border on active, no pill background.
- **Toasts / inline notifications**: rectangular with a left status-color bar (success/error/warning), structured icon + heading + body + actions.
- **Cards / tiles**: borderless or with hairline border on `surface`, no rounding, no shadow on default.

## Layout

Carbon uses a 16-column grid with a 2x grid mod (8/16/24 px increments). Max widths are large (1584 px) to support data-heavy enterprise apps. Marketing uses a 12-column variation with max ~1312 px and section padding of 64-96 px. The 8 px base unit is unusually large compared to consumer brands.

## Depth & Elevation

Carbon is rigorously flat. Default UI uses no shadows — surfaces are distinguished by background tone (`background` → `surface` → `surface02`). Elevation appears only on overlays: tooltips, popovers, modals, toasts. The "raised" style uses a single soft drop shadow.

## Do's & Don'ts

**Do**
- Use IBM Plex for everything; the typeface is the brand.
- Default to rectangular geometry — zero corner radii on chrome.
- Use weight 300 for display headlines; the thin look is signature IBM.
- Build dense data tables with hairline dividers, sortable column headers, mono on IDs.
- Reserve drop shadows for overlays only — default surfaces are flat.

**Don't**
- Round corners on chrome — Carbon is rectilinear.
- Use bold (700+) display weights; IBM display goes thin.
- Decorate with gradients or glows.
- Use a substitute typeface; Plex is essential.
- Apply drop shadows to inline cards.

## Responsive Behavior

Carbon ships breakpoints at 320 / 672 / 1056 / 1312 / 1584 px. Below 672 px the 16-column grid collapses to 4-column; data tables become horizontally scrollable rather than reflowing; left side nav collapses behind a hamburger. Display headlines drop from 54 to 28 px. Status banners stack vertically.

## Agent Prompt Guide

When asked to design "in the style of IBM":
1. Use IBM Plex Sans (or Helvetica Neue / Inter as fallback) throughout — the typeface is the brand.
2. Set display in weight 300 (light) for the signature thin look.
3. Default to zero corner radii — rectangular buttons, inputs, cards.
4. Anchor on IBM Blue 60 (`#0F62FE`) primary CTAs against gray-10 (`#F4F4F4`) section bands.
5. Build dense data tables with hairline dividers and mono ID columns; reserve shadow for overlays only.

---
*Inspired by IBM. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
