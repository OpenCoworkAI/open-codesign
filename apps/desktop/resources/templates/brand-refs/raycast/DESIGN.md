---
name: Raycast
slug: raycast
category: Productivity
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Raycast. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#FF6363"
  secondary: "#0D0D0D"
  background: "#0D0D0D"
  surface: "#171717"
  surfaceRaised: "#1F1F1F"
  text: "#F2F2F2"
  muted: "#8C8C8C"
  border: "#262626"
  accent: "#FF6363"
  highlight: "#FF8E8E"

typography:
  display:
    fontFamily: "Söhne, Inter Display, Inter, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "JetBrains Mono, SF Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.40)"
  md: "0 12px 32px rgba(0,0,0,0.50)"
  lg: "0 32px 60px rgba(0,0,0,0.60)"

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

Raycast is a beautifully crafted command palette for the Mac, and the marketing site reads like an Apple-product page rendered by an indie team that loves graphic design. Pages are dark, type-led, and full of polished product mockups (the command bar, results lists, AI chat) floating against subtle gradient backgrounds. The signature accent is coral-red (`#FF6363`) — used on the Raycast logo and primary CTAs.

The product itself is a translucent floating panel — the marketing site captures that floating-glass feel with soft shadows and gentle gradients on hero sections.

## Color Palette & Roles

- `primary` (`#FF6363`) — Raycast coral; primary CTAs, brand mark, accent rules.
- `background` (`#0D0D0D`) — near-black canvas.
- `surface` (`#171717`) — section bands and card backgrounds.
- `surfaceRaised` (`#1F1F1F`) — hover and floating panel.
- `text` (`#F2F2F2`) — primary copy.
- `muted` (`#8C8C8C`) — secondary copy, keyboard chip labels.
- `border` (`#262626`) — hairline.
- `highlight` (`#FF8E8E`) — hover state on coral CTAs.

## Typography

Söhne (or Inter Display as fallback) at weight 600, tight tracking (-0.025em), 1.05 line-height. Body Inter 400, 1.55 line-height. Mono (JetBrains Mono or SF Mono) appears in keyboard shortcut chips and code samples.

Hierarchy: hero (56-80 px) → section (32-40 px) → body (16 px) → caption/mono (13 px). Keyboard chips are everywhere — Raycast is a keyboard-first product.

## Components

- **Command palette mockup**: floating dark rounded-xl panel with soft drop shadow, search input at top, list rows below with icon + label + keyboard chip on the right. The hero element of the brand.
- **Buttons**: 36-44 px height, 8 px radius. Primary: solid coral background with white text, no border. Secondary: transparent with 1 px `border`, `text` color.
- **Keyboard chips**: monospaced ~12 px on `surfaceRaised` background, 1 px `border`, 4 px radius, often paired with a "+" or "→".
- **Cards**: `surface` background, 12 px radius, hairline border, soft `sm` shadow.
- **Inputs**: 36 px height, 6 px radius, 1 px border, brightens on focus.

## Layout

12-column grid, max content width ~1240 px. Section padding 96-128 px. Marketing pages center the floating command-palette mockup on a soft gradient background, then alternate feature bands below. Long-form blog posts use a narrow content column (~720 px).

## Depth & Elevation

The brand's signature is the floating-panel effect: a dark rounded panel with soft `md` or `lg` shadow against a subtle gradient background. Shadows are dark and long; cards lift on hover. Subtle gradient washes (radial blur, soft purple/pink tints) appear behind the hero panel — the only chromatic decoration outside coral.

## Do's & Don'ts

**Do**
- Center the page on a floating command-palette mockup as hero.
- Use coral (`#FF6363`) as the only accent; one CTA per band.
- Show keyboard shortcuts as monospaced chips next to actions everywhere.
- Set type in Söhne or Inter at weight 600 for display, with tight tracking.
- Apply soft long shadows to floating panels for the signature glass feel.

**Don't**
- Use a light theme as default; Raycast's identity is dark.
- Cluster multiple coral elements; the accent should be rare.
- Use heavy 700+ display weights; 600 is the brand's max.
- Decorate with neon glows or hard color gradients.
- Show the full app UI on marketing; show focused mockups instead.

## Responsive Behavior

Below 960 px the floating command-palette mockup scales down with its rounded corners and shadows intact. Hero headlines drop from ~80 px to ~32 px; section padding compresses from 128 to 64 px. Multi-column feature bands collapse to single column; keyboard chips remain visible but stack below the action label rather than to the right.

## Agent Prompt Guide

When asked to design "in the style of Raycast":
1. Build a dark canvas (`#0D0D0D`) with a subtle radial gradient behind the hero.
2. Center the page on a floating dark rounded-xl command-palette mockup with soft long shadow.
3. Set type in Söhne or Inter at weight 600, tight tracking, 56-80 px on hero.
4. Use coral (`#FF6363`) as the only accent — one primary CTA, the brand mark.
5. Show keyboard shortcuts as monospaced chips on `surfaceRaised` next to every action — keyboard-first is the brand.

---
*Inspired by Raycast. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
