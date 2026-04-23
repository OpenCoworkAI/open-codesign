---
name: Apple
slug: apple
category: Consumer
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Apple. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#0071E3"
  secondary: "#1D1D1F"
  background: "#FFFFFF"
  surface: "#F5F5F7"
  text: "#1D1D1F"
  muted: "#6E6E73"
  border: "#D2D2D7"
  accent: "#0071E3"
  successGreen: "#2D8A3E"
  alertRed: "#BF4800"

typography:
  display:
    fontFamily: "SF Pro Display, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "SF Pro Text, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.47
    letterSpacing: "-0.016em"
  mono:
    fontFamily: "SF Mono, Menlo, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192]

radius:
  none: "0"
  sm: "6px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  full: "9999px"

shadows:
  sm: "0 1px 4px rgba(0,0,0,0.04)"
  md: "0 4px 16px rgba(0,0,0,0.08)"
  lg: "0 24px 60px rgba(0,0,0,0.12)"

motion:
  duration:
    fast: "150ms"
    normal: "300ms"
    slow: "600ms"
  easing:
    standard: "cubic-bezier(0.42, 0, 0.58, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Apple.com is the canonical "luxury technology" page: enormous product photography on white or near-black backgrounds, very large display type, generous vertical rhythm, and a pill-shaped action button in Apple-blue. Pages alternate between full-bleed product hero sections (often dark) and lighter editorial bands (often `surface` gray). Motion is subtle — fades, parallax, scroll-driven product reveals — never bouncy.

The brand reads premium because it withholds: minimal color, restrained typography, almost no decoration, oceans of white space.

## Color Palette & Roles

- `primary` (`#0071E3`) — Apple blue; reserved for links, CTAs, focus rings.
- `secondary` (`#1D1D1F`) — near-black; primary text and dark hero backgrounds.
- `background` (`#FFFFFF`) — primary canvas in light hero bands.
- `surface` (`#F5F5F7`) — pale gray editorial bands.
- `muted` (`#6E6E73`) — secondary copy, captions.
- `border` (`#D2D2D7`) — hairline; rarely visible.

Beyond these neutrals and Apple blue, color in marketing comes from product photography itself (anodized aluminum, OLED screen content). The brand avoids painted accent colors on chrome.

## Typography

SF Pro Display for headings (>20 px), SF Pro Text for body (<20 px) — Apple ships specific optical sizes. Display weights 500-700 with very tight tracking (-0.02 to -0.04em); body at 400 with looser tracking (-0.016em). Hero headlines often hit 80-104 px on desktop.

Hierarchy is enforced through enormous scale jumps: hero (80-104 px) → section (40-56 px) → eyebrow (12-14 px uppercase) → body (17 px). The 17 px body baseline is a long-standing Apple convention.

## Components

- **Buttons**: pill-shaped (rounded-full or 980 px radius), 14-16 px vertical padding. Primary: solid Apple blue, white text, no border, no shadow. Secondary: blue text on transparent background with the same pill outline.
- **Eyebrow text**: 12-14 px, uppercase, tracked +0.05em, used above hero headlines as a category label.
- **Cards**: 18 px radius, soft `md` shadow on hover; product tiles often use the `surface` background.
- **Navigation**: thin (44 px) translucent top bar with backdrop blur; expands on hover for category mega-menus.
- **Footer**: dense multi-column legal/menu structure on `surface` background, 12 px text.

## Layout

12-column grid, max content width ~1024-1240 px depending on page. Vertical rhythm is generous: section padding rarely below 96 px, often 128-192 px between major bands. Hero sections often go full-bleed; secondary content respects the central column.

## Depth & Elevation

The product surface is nearly flat with the exception of hover-state lifts on product tiles and modal overlays. Marketing depth comes from photography (lit aluminum, OLED glow, depth-of-field) and from scroll-driven parallax — never from drop shadows on UI chrome. Translucent backdrop blur is reserved for the top navigation.

## Do's & Don'ts

**Do**
- Lead with massive product photography on full-bleed hero bands.
- Use SF Pro at 500-700 weight with tight negative tracking for hero headlines.
- Pill-shape primary CTAs in Apple blue, no border, no shadow.
- Alternate light and dark sections vertically; let photography drive the mood.
- Use a 12-14 px uppercase eyebrow above section headlines.

**Don't**
- Decorate with gradients or painted accents — let product photography supply color.
- Use rounded corners smaller than ~6 px on cards and tiles.
- Crowd the hero with multiple CTAs; one primary action.
- Use pure black for text — `#1D1D1F` is the brand color.
- Animate with bouncy or playful easing; Apple motion is smooth and slow.

## Responsive Behavior

Apple.com adapts at 1068, 734, and 320 px breakpoints. Hero headlines drop from ~96 to ~48 px, and section padding compresses from 192 to 64 px. Navigation collapses behind a hamburger at ≤ 734 px. Product tiles reflow from 4-up to 2-up to 1-up. Hero photography remains the focal point at every size.

## Agent Prompt Guide

When asked to design "in the style of Apple":
1. Lead with one enormous photograph or product render on a full-bleed hero band.
2. Set hero text in SF Pro Display, weight 600, tight tracking (-0.025em), 80-104 px on desktop.
3. Use a single Apple-blue pill CTA, no border, no shadow.
4. Alternate `background` (white) and `surface` (`#F5F5F7`) editorial bands; let photography drive color elsewhere.
5. Be generous with vertical space — section padding 96-192 px, never under 64 px.

---
*Inspired by Apple. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
