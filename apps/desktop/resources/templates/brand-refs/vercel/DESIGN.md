---
name: Vercel
slug: vercel
category: Dev Tools
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Vercel. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#0070F3"
  secondary: "#000000"
  background: "#FFFFFF"
  surface: "#FAFAFA"
  text: "#171717"
  muted: "#666666"
  border: "#EAEAEA"
  accent: "#0070F3"
  success: "#0070F3"
  warning: "#F5A623"
  error: "#E00"
  gradientFrom: "#7928CA"
  gradientTo: "#FF0080"

typography:
  display:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.1
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.6
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "Geist Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.04)"
  md: "0 4px 12px rgba(0,0,0,0.06)"
  lg: "0 12px 32px rgba(0,0,0,0.08)"

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

Vercel's surface is monochrome, near-flat, and quietly confident — a black triangle on a white page. Geometry is rounded just enough to feel software-native, never decorative. Hierarchy comes from weight and scale, almost never from hue. The single splash of color is a magenta-to-violet conic gradient reserved for hero moments.

Everything else is built from neutrals: pure white surfaces, near-black text, and a single grey scale that does most of the work.

## Color Palette & Roles

- `primary` (`#0070F3`) — historic Vercel blue; now used sparingly on links and informational highlights.
- `secondary` (`#000000`) — the default UI accent; primary buttons, the wordmark, focus outlines.
- `background` — pure white in light mode; pure black in dark mode (no off-white).
- `surface` (`#FAFAFA`) — page sections that need separation without a border.
- `text` (`#171717`) — body copy; never pure black.
- `muted` (`#666666`) — secondary copy, captions, inactive states.
- `border` (`#EAEAEA`) — single hairline; never doubled, never dashed.
- `gradientFrom` → `gradientTo` — the famous magenta→violet conic; reserved for hero illustrations and product launch moments. Never on UI chrome.

## Typography

Geist is the house family — both sans and mono. Display headlines use tight tracking (-0.04em) and 600 weight; body copy uses -0.011em and 400. Numerals are tabular in dashboards.

Hierarchy is enforced through scale and weight, not color. A page rarely has more than three type sizes above the body. Mono is used for code, command names, and version strings — never for emphasis.

## Components

- **Buttons**: 32-40 px height, 6 px radius. Primary is solid black on white background, no border, no hover lift — only a subtle background-shift on hover. Secondary is white with a 1 px `border` and `text` color.
- **Cards**: borderless on `surface`; 1 px `border` on raised cards. No drop shadows in default theme — elevation is implied by border or background tone.
- **Inputs**: 1 px border, 6 px radius, 36 px height. Focus state thickens the border to 2 px in `secondary` (black) — no glow.
- **Tabs**: underline only, no pill background. Active tab bolds and gains a 2 px bottom border.
- **Badges**: rounded-full pills, mono-cased label, neutral background, no icon by default.

## Layout

12-column responsive grid. Max content width: 1200 px for marketing, 1400 px for the dashboard. Vertical rhythm uses 4 px units; section gaps are typically 96 or 128 px on marketing pages, 32-48 px in the dashboard. Generous left/right padding keeps the page feeling spacious; no edge-to-edge content except hero gradients.

## Depth & Elevation

Vercel is essentially flat. Elevation is communicated by border-tone deltas (background → surface → border) and by subtle 1-2 px shadows on actively hovered cards. No drop shadows on default state. No glassmorphism. Dark mode inverts neutrals but keeps the same flatness.

## Do's & Don'ts

**Do**
- Lean on Geist's tight tracking for hero headlines.
- Use the magenta-violet gradient for one hero element per page.
- Treat black as the primary action color.
- Keep borders to a single hairline weight (1 px, `#EAEAEA`).
- Use mono for version numbers, deploy IDs, and command snippets.

**Don't**
- Decorate with shadows or gradient fills on UI chrome.
- Use Vercel blue as a primary CTA — black does that job.
- Mix two accent colors on the same page.
- Add icons to badges or buttons unless functionally required.
- Use rounded-full radii on anything except avatars and pill badges.

## Responsive Behavior

Mobile (≤ 640 px) collapses the 12-column grid to a single column with 16 px side padding. Marketing hero headlines drop from ~80 px to ~40 px. Navigation collapses behind a top-right menu icon — no hamburger label. Dashboard tables become horizontally scrollable rather than reflowing.

## Agent Prompt Guide

When asked to design "in the style of Vercel":
1. Strip the page to monochrome neutrals; reserve a single accent slot for the hero gradient.
2. Use Geist (or Inter as fallback) with tight negative tracking on display, generous line-height on body.
3. Keep elevation flat: borders and tonal background shifts only, no drop shadows on default state.
4. Make the primary CTA solid black with no border or shadow; secondary is white with a 1 px border.
5. Reserve the magenta→violet gradient for one hero element. Never paint UI chrome with it.

---
*Inspired by Vercel. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
