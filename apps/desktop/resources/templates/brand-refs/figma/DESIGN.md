---
name: Figma
slug: figma
category: Design Tools
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Figma. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#0D99FF"
  secondary: "#1E1E1E"
  background: "#FFFFFF"
  surface: "#F5F5F5"
  text: "#1E1E1E"
  muted: "#757575"
  border: "#E5E5E5"
  accent: "#A259FF"
  brandRed: "#F24E1E"
  brandOrange: "#FF7262"
  brandGreen: "#0FA958"
  brandPurple: "#A259FF"

typography:
  display:
    fontFamily: "Whyte, Inter, system-ui, sans-serif"
    weight: 500
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Whyte, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "Whyte Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 40, 64, 96, 128]

radius:
  none: "0"
  sm: "2px"
  md: "6px"
  lg: "12px"
  xl: "20px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(0,0,0,0.06)"
  md: "0 4px 16px rgba(0,0,0,0.08)"
  lg: "0 12px 32px rgba(0,0,0,0.12)"

motion:
  duration:
    fast: "120ms"
    normal: "200ms"
    slow: "320ms"
  easing:
    standard: "cubic-bezier(0.2, 0, 0, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Figma's brand mixes the famous five-color logo (red, orange, green, purple, blue) with a clean editor chrome that recedes. Marketing pages are colorful, playful, and image-rich — covers feature large product screenshots framed by colored shapes. The product itself is the opposite: near-monochrome dark editor with a single blue accent for selection.

The two surfaces stay deliberately separate. Marketing celebrates the logo palette; the editor stays out of the designer's way.

## Color Palette & Roles

- `primary` (`#0D99FF`) — selection blue; the only accent in the editor chrome.
- `text` (`#1E1E1E`) — near-black; primary copy.
- `background` (`#FFFFFF`) — white in marketing; `#2C2C2C` in the editor (dark by default).
- `surface` (`#F5F5F5`) — pale gray section bands.
- `border` (`#E5E5E5`) — hairline; rarely visible inside the editor.
- Brand pentachord (`#F24E1E` red, `#FF7262` orange, `#0FA958` green, `#A259FF` purple, `#0D99FF` blue) — appears on logo, illustrations, and as colored shape backgrounds in marketing. Not used as UI chrome.

## Typography

Whyte (Dinamo Type Foundry) is the brand face — a humanist sans with slightly narrow proportions. Display weight is 500 with -0.025em tracking; body is 400 with looser tracking. Inter is the safe fallback.

Hierarchy on marketing pages is dramatic — hero headlines often span 80-120 px and dominate the viewport. The editor uses 11-12 px UI text throughout — Figma is a tool, and the chrome is intentionally small.

## Components

- **Buttons** (marketing): 40-48 px height, 6 px radius, generous horizontal padding, primary in `text` (near-black) on white pages, white on dark.
- **Buttons** (editor): 24-28 px height, 2-4 px radius, very compact.
- **Cards**: 12 px radius, soft `md` shadow, often featuring a colored accent shape behind a product screenshot.
- **Inputs** (editor): 24 px height, 2 px radius, no border by default; border appears on hover/focus.
- **Toolbar**: 40 px tall, dark gray, icon-only, tightly packed.
- **Avatars**: rounded-full with deterministic color from user ID.

## Layout

Marketing pages use a 12-column grid with max width ~1200 px and large 96-128 px section breaks. Inside the editor, the layout is fixed: 40 px top bar, 240 px left/right panels, infinite center canvas. The editor never tries to be responsive in the marketing sense — it adapts to window size by collapsing panels.

## Depth & Elevation

Marketing uses soft drop shadows and layered colored shapes for depth. The editor is flat: panels separated by 1 px borders, popovers with subtle `md` shadow. Modal dialogs use `lg` shadow with a dimmed backdrop. Selection highlights use 1 px solid blue stroke with no fill, matching the canvas object treatment.

## Do's & Don'ts

**Do**
- Use the five-color brand palette on marketing illustrations and decorative shapes.
- Frame product screenshots with colored geometric shapes (circles, squares, blobs).
- Keep editor chrome dense and small (11-12 px text, 24 px controls).
- Use blue `#0D99FF` for selection and only selection inside product surfaces.
- Treat marketing and editor as two visual languages.

**Don't**
- Use the five brand colors as UI chrome inside the editor.
- Make editor controls bigger to match marketing scale.
- Apply gradients in the editor; flat fills only.
- Use pure black; `#1E1E1E` is the brand text color.
- Drop shadow editor panels — they live on hairline borders.

## Responsive Behavior

Marketing collapses to a single column at ≤ 768 px; hero headlines drop from ~96 px to ~40 px and section padding from 128 to 64 px. The editor itself is desktop-first; on mobile, Figma ships a separate "viewer" experience with simplified chrome and gestural pan/zoom rather than reflowing the editor UI.

## Agent Prompt Guide

When asked to design "in the style of Figma":
1. Decide if you're designing marketing (colorful, playful, image-rich) or editor chrome (dense, near-monochrome, tiny controls).
2. For marketing: feature one or two large product screenshots framed by colored shapes from the five-color brand palette.
3. For editor: dark gray panels, 1 px borders, 24 px controls, blue selection accent.
4. Use Whyte (or Inter) — display at 500 weight with tight tracking, body at 400.
5. Keep the two surfaces visually distinct; never bring marketing colors into editor chrome.

---
*Inspired by Figma. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
