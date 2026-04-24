---
name: Supabase
slug: supabase
category: Dev Tools
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Supabase. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#3ECF8E"
  secondary: "#1F1F1F"
  background: "#1C1C1C"
  surface: "#2A2A2A"
  surfaceRaised: "#333333"
  text: "#EDEDED"
  muted: "#A0A0A0"
  border: "#383838"
  accent: "#3ECF8E"
  brandGreenDark: "#249361"

typography:
  display:
    fontFamily: "Custom Display, Inter, system-ui, sans-serif"
    weight: 500
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Custom Sans, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "Source Code Pro, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.30)"
  md: "0 8px 24px rgba(0,0,0,0.40)"
  lg: "0 24px 48px rgba(0,0,0,0.50)"

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

Supabase is the open-source Firebase, and the brand wears that earnestly — dark editor-feel, terminal greens, code-on-screen as hero content. The marketing surface uses warm dark grays (a touch warmer than Vercel's near-black) with the unmistakable mint-green logo as the only accent. Pages are dense with code samples, side-by-side product screenshots, and small mono captions.

The dashboard is the same palette — a flat dark UI that feels comfortable next to a terminal.

## Color Palette & Roles

- `primary` (`#3ECF8E`) — Supabase mint-green; brand wordmark, primary CTAs, code-block syntax accents.
- `background` (`#1C1C1C`) — warm dark gray canvas.
- `surface` (`#2A2A2A`) — section bands and card backgrounds.
- `surfaceRaised` (`#333333`) — hover and modal surfaces.
- `text` (`#EDEDED`) — primary copy on dark.
- `muted` (`#A0A0A0`) — secondary copy, captions.
- `border` (`#383838`) — hairline.
- `brandGreenDark` (`#249361`) — pressed state on green CTAs.

## Typography

The brand uses a custom display sans (recently introduced) with Inter as a long-standing fallback. Display weight 500, -0.025em tracking, 1.1 line-height; body weight 400, 1.55 line-height. Mono (Source Code Pro) is used heavily — code samples are first-class hero content.

Hierarchy: hero (56-72 px) → section (32-40 px) → body (16 px) → caption (13 px) → mono inline (14 px).

## Components

- **Buttons**: 32-40 px height, 4-6 px radius. Primary: solid mint-green with dark text, no border. Secondary: transparent with 1 px `border`, `text` color.
- **Code blocks**: dark background slightly lighter than canvas, mono font, syntax highlighting using brand-green for accent tokens (keywords, function names).
- **Cards**: 8 px radius, `surface` background, 1 px hairline border, no shadow on default.
- **Inputs**: 36 px height, 6 px radius, 1 px `border`, brightens on focus with a faint green glow.
- **Tabs**: text-only with bottom underline; active tab gains green underline.
- **Tables**: dense rows (32 px), hairline dividers, mono for IDs/keys columns.

## Layout

12-column grid, max marketing width ~1240 px. Section padding 96-128 px on marketing, 24-32 px in dashboard. Dashboard uses a 240 px left nav + main content; full-width tables are common for database views.

## Depth & Elevation

The brand is flat dark. Cards and panels are distinguished by background brightness (`background` → `surface` → `surfaceRaised`) more than by border or shadow. Modals and popovers use soft `md` shadows. Code blocks float on the canvas with no border but a slightly different background.

## Do's & Don'ts

**Do**
- Default to dark mode; warm gray (`#1C1C1C`) not pure black.
- Treat code samples as hero content, syntax-highlighted with the brand green for accent tokens.
- Use mint-green (`#3ECF8E`) as the only accent — for CTAs, brand mark, code highlights.
- Show side-by-side comparisons (SQL editor + result table) on marketing.
- Use mono for IDs, keys, table cells of structured data.

**Don't**
- Use a second accent color; mint green does the whole job.
- Use pure black backgrounds — Supabase greys are warm.
- Add drop shadows to inline content; rely on background tone.
- Decorate with neon glows or gradients on UI chrome.
- Use proportional digits in dense data tables.

## Responsive Behavior

Below ~960 px the dashboard sidebar collapses to a tab bar; below ~720 px tables become horizontally scrollable rather than reflowing. Marketing hero headlines scale from ~72 px to ~36 px; section padding from 128 to 64 px. Code blocks remain horizontally scrollable with sticky line numbers.

## Agent Prompt Guide

When asked to design "in the style of Supabase":
1. Anchor on warm dark gray (`#1C1C1C`) with mint-green (`#3ECF8E`) as the only accent.
2. Set display in a tight 500-weight sans (Inter), body with comfortable line-height.
3. Make code samples first-class — large mono blocks with syntax highlighting using the brand green.
4. Build the dashboard with dense tables, hairline borders, mono columns for keys/IDs.
5. Keep depth flat — distinguish surfaces by background brightness, not shadow.

---
*Inspired by Supabase. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
