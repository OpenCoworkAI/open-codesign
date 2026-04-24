---
name: Linear
slug: linear
category: Productivity
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Linear. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#5E6AD2"
  secondary: "#26282F"
  background: "#08090A"
  surface: "#101113"
  text: "#F7F8F8"
  muted: "#8A8F98"
  border: "#23252A"
  accent: "#5E6AD2"
  highlight: "#7B8AFF"
  success: "#4CB782"
  warning: "#F2C94C"
  error: "#EB5757"

typography:
  display:
    fontFamily: "Inter Display, Inter, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.1
    letterSpacing: "-0.022em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "Berkeley Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]

radius:
  none: "0"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.20)"
  md: "0 8px 24px rgba(0,0,0,0.30)"
  lg: "0 24px 48px rgba(0,0,0,0.40)"

motion:
  duration:
    fast: "100ms"
    normal: "180ms"
    slow: "300ms"
  easing:
    standard: "cubic-bezier(0.25, 0.1, 0.25, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Linear is keyboard-first software dressed in a slate-gray cathedral. The base aesthetic is dark, near-black, with cool desaturated grays and a single periwinkle accent (`#5E6AD2`) doing all the work. Hero pages ship subtle moving gradients and abstract aurora effects, but the product UI is dense, quiet, and built for speed.

Type is precise and slightly tight; spacing is compact. The brand reads less like a SaaS marketing site and more like a developer tool that happens to have a beautiful skin.

## Color Palette & Roles

- `primary` (`#5E6AD2`) — the periwinkle Linear-blue; used for primary CTAs, hover states on selected rows, and brand chrome.
- `background` (`#08090A`) — the near-black canvas for the app and dark marketing pages.
- `surface` (`#101113`) — sidebars, modals, raised panels.
- `text` (`#F7F8F8`) — primary copy; deliberately off-white.
- `muted` (`#8A8F98`) — secondary copy, timestamps, metadata.
- `border` (`#23252A`) — single hairline; almost invisible by design.
- `highlight` (`#7B8AFF`) — slightly brighter periwinkle for hover states only.

Light theme exists but is secondary; the brand identity lives in dark mode.

## Typography

Inter (with Inter Display for hero copy) is the workhorse. Display weight is 600 with -0.022em tracking; body is 400 with -0.011em. Hierarchy is enforced through scale and weight, never color — secondary copy is the only thing that ever shifts hue (to `muted`).

Mono (Berkeley Mono on marketing, JetBrains Mono in product) appears in keyboard-shortcut chips and code blocks.

## Components

- **Buttons**: 28-32 px height, 6 px radius. Primary: solid `primary` background, no border, no shadow, color shift on hover. Secondary: transparent background, 1 px `border`, `text` color.
- **Inputs**: 32 px height, 6 px radius, 1 px border that brightens on focus (no glow, no ring).
- **Issue rows**: dense list rows, 32 px tall, no separators — only background hover state.
- **Keyboard chips**: monospaced, ~10-12 px, rounded-md, 1 px border, used everywhere shortcuts are shown.
- **Modals**: centered, 480-640 px wide, 12 px radius, soft `lg` shadow, no backdrop blur.
- **Avatars**: rounded-full, deterministic gradient fill from initials.

## Layout

App is a three-column layout: 240 px sidebar, fluid main, optional 320 px detail rail. Marketing pages cap at ~1100 px. Dense vertical rhythm — 4 and 8 px increments dominate; rarely above 64 px gaps in product, larger gaps (96-128 px) on marketing.

## Depth & Elevation

The product is essentially flat with hairline borders. Elevation is reserved for modals, popovers, and toasts — and even then, the shadow is dark and soft rather than bright. Marketing hero sections introduce a signature aurora/gradient haze that fades to background; this is the only "depth" effect on the marketing surface and is never repeated within the product UI.

## Do's & Don'ts

**Do**
- Default to dark mode; use cool desaturated grays.
- Show keyboard shortcuts everywhere — chips next to menu items, tooltips, command palette.
- Keep rows dense (28-32 px) and let hover-fill carry the affordance.
- Use periwinkle as the single brand color; never introduce a second hue.
- Animate transitions briskly (100-180 ms) with smooth standard easing.

**Don't**
- Use drop shadows for non-floating elements.
- Add iconography to row items unless functionally required.
- Switch to a warm gray; Linear's grays are cool.
- Use the periwinkle as a background fill at full saturation — it's an accent.
- Animate longer than 300 ms; Linear feels fast.

## Responsive Behavior

Below ~960 px the right detail rail collapses; below ~720 px the sidebar collapses behind a hamburger. Marketing hero headlines scale from ~84 px to ~36 px. Mobile retains dark mode by default and never reflows dense issue lists into cards — they stay as compact rows.

## Agent Prompt Guide

When asked to design "in the style of Linear":
1. Start dark: `#08090A` background, `#F7F8F8` text, `#23252A` borders.
2. Pick periwinkle (`#5E6AD2`) as the only accent. Use it on the primary CTA and selected-row state.
3. Use Inter with tight tracking; 600 weight on headings, 400 on body, scale-based hierarchy.
4. Keep components compact: 32 px controls, 6 px radius, 1 px hairline borders.
5. Surface keyboard shortcuts as mono chips next to actions; the brand believes in keyboard-first.

---
*Inspired by Linear. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
