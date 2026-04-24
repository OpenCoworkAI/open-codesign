---
name: Cal.com
slug: cal-com
category: SaaS
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Cal.com. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#111827"
  secondary: "#0E1A35"
  background: "#FFFFFF"
  surface: "#F9FAFB"
  text: "#111827"
  muted: "#6B7280"
  border: "#E5E7EB"
  accent: "#292929"
  brandBlue: "#292929"
  successGreen: "#10B981"
  errorRed: "#EF4444"

typography:
  display:
    fontFamily: "Cal Sans, Inter Display, Inter, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.55
    letterSpacing: "-0.011em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"

shadows:
  sm: "0 1px 2px rgba(15,23,42,0.04)"
  md: "0 4px 16px rgba(15,23,42,0.08)"
  lg: "0 16px 40px rgba(15,23,42,0.12)"

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

Cal.com is the open-source Calendly with a designer's eye. The brand uses Cal Sans — its proprietary geometric display face — paired with Inter for body. Marketing pages are calm, monochrome (near-black + white), and built around the booking-page widget itself as the hero element. The product is minimal, deliberately calendar-shaped, and respects the user's time visually as much as functionally.

The brand voice is thoughtful and quietly confident — closer to a design boutique than a SaaS startup.

## Color Palette & Roles

- `primary` (`#111827`) — near-black; primary CTAs, brand chrome.
- `text` (`#111827`) — primary copy.
- `background` (`#FFFFFF`) — white in light mode (default).
- `surface` (`#F9FAFB`) — pale gray section bands.
- `muted` (`#6B7280`) — secondary copy, captions.
- `border` (`#E5E7EB`) — hairline.
- `successGreen` / `errorRed` — confirmation and error states only.

The brand intentionally avoids a chromatic accent — black does the CTA work, and the booking-page widget supplies most of the visual interest.

## Typography

Cal Sans (custom display, by Pablo Stanley) is the brand face — geometric sans with confident proportions, used for display only. Body is Inter at weight 400. Display weight 600, tight tracking (-0.025em), 1.05 line-height.

Hierarchy: hero (56-80 px Cal Sans) → section (32-40 px) → body (16 px Inter) → caption (13 px). Mono appears for time codes and keyboard chips.

## Components

- **Booking-page widget**: white card on `surface`, ~12 px radius, hairline border, soft `sm` shadow. Hosts a small calendar grid and a column of time slots — the brand's signature mockup.
- **Buttons**: 36-44 px height, 8 px radius. Primary: solid `text` background with white type, no border. Secondary: white with 1 px `border`, `text` color.
- **Time-slot chips**: rectangular pills, 1 px border, brighten on hover.
- **Inputs**: 40 px height, 8 px radius, 1 px `border` brightening on focus.
- **Tabs**: text only with bottom underline; active tab gains 2 px `text` underline.
- **Avatars**: rounded-full with deterministic color from initials.

## Layout

12-column grid, max marketing width ~1200 px. Section padding 96-128 px on marketing. The booking page itself uses a centered narrow column (~720 px) with the widget anchored at the top. Product dashboard uses a 240 px sidebar with main content cards.

## Depth & Elevation

The brand is mostly flat with rounded soft elevation. The booking widget gets a subtle `sm` shadow; cards lift on hover. Modals and popovers use `md` shadow. No glassmorphism, no glow.

## Do's & Don'ts

**Do**
- Center the marketing page on the booking-widget mockup as hero.
- Use Cal Sans (or Inter Display) at weight 600 for display headlines, with tight tracking.
- Anchor on near-black (`#111827`) primary CTAs against a clean white canvas.
- Show time-slot chips as small rectangular buttons in a tight column.
- Keep chrome calm — hairline borders, soft shadows, generous whitespace.

**Don't**
- Introduce a chromatic accent — black does the CTA work.
- Use bold (700+) display weights; Cal Sans 600 is the brand's max.
- Decorate with gradients or glows.
- Square corners on chrome — the brand is gently rounded.
- Cluster multiple CTAs; one primary action per band.

## Responsive Behavior

Below 960 px the booking-widget mockup scales down with its calendar grid intact. Hero headlines drop from ~80 px to ~36 px; section padding compresses from 128 to 64 px. The actual booking page on mobile reflows to stack the calendar above the time-slot column rather than side-by-side. The dashboard sidebar collapses behind a hamburger.

## Agent Prompt Guide

When asked to design "in the style of Cal.com":
1. Center the marketing page on a calendar/booking-widget mockup as the hero element.
2. Set display in Cal Sans (or Inter Display) at weight 600, tight tracking, 56-80 px.
3. Use near-black (`#111827`) primary CTAs against a clean white canvas — no chromatic accents.
4. Build the booking widget with a small calendar grid + time-slot chip column inside a hairline-bordered card.
5. Keep depth gentle — hairline borders, soft shadows on widgets, no glow or gradient decoration.

---
*Inspired by Cal.com. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
