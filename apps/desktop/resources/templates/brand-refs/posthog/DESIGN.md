---
name: PostHog
slug: posthog
category: Dev Tools
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by PostHog. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#1D4AFF"
  secondary: "#F54E00"
  background: "#EEEFE9"
  surface: "#FFFFFF"
  text: "#151515"
  muted: "#5F5F5F"
  border: "#000000"
  accent: "#F54E00"
  yellow: "#F9BD2B"
  green: "#29DBBB"
  brick: "#B62B17"

typography:
  display:
    fontFamily: "MatterSQ, Matter, Inter, system-ui, sans-serif"
    weight: 700
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  body:
    fontFamily: "MatterSQ, Matter, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "0"
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
  lg: "16px"
  xl: "24px"
  full: "9999px"

shadows:
  sm: "2px 2px 0 #000"
  md: "4px 4px 0 #000"
  lg: "8px 8px 0 #000"

motion:
  duration:
    fast: "100ms"
    normal: "180ms"
    slow: "300ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

PostHog is gleefully weird for a B2B analytics tool — cream paper background, hand-drawn hedgehog mascot, neo-brutalist offset shadows ("2px 2px 0 black"), and bright primary accents. Marketing pages are dense with copy, illustrations, and joke captions; the brand voice is irreverent. The product UI is calmer but inherits the cream surface, the heavy black borders, and the same Matter typeface.

The brand reads like an indie-zine version of Mixpanel.

## Color Palette & Roles

- `primary` (`#1D4AFF`) — bright blue; primary CTAs and brand chrome.
- `secondary` (`#F54E00`) — bright orange; secondary accent on illustrations.
- `background` (`#EEEFE9`) — cream paper tone; the brand's defining canvas color.
- `surface` (`#FFFFFF`) — white cards on cream background.
- `text` (`#151515`) — near-black.
- `border` (`#000000`) — pure black, often 1.5-2 px thick — central to the neo-brutalist look.
- `yellow` (`#F9BD2B`), `green` (`#29DBBB`), `brick` (`#B62B17`) — illustration palette for hedgehogs and decorative elements.

## Typography

Matter (originally MatterSQ for the squared variant) is the brand face — geometric sans with slightly squared terminals. Display weight 700 with -0.02em tracking; body weight 400. Inter is the safe fallback.

Hierarchy uses bold size jumps: hero (64-80 px) → section (32-40 px) → body (16-18 px) → caption (13-14 px). Mono is used for code snippets and event names.

## Components

- **Buttons**: primary blue with 2 px black border and the signature `4px 4px 0 #000` offset shadow — looks like a stamped sticker. 36-44 px height, 8 px radius.
- **Cards**: white with 2 px black border and offset shadow; 16 px radius. The shadow snaps off on hover (translate +2/+2 to "press" the card).
- **Inputs**: 40 px height, 1.5 px black border, 6 px radius, no shadow.
- **Illustrations**: hand-drawn hedgehogs, signposts, and other characters scattered through marketing pages.
- **Tags / chips**: pill-shaped with thick black borders, often colored backgrounds.

## Layout

Marketing pages are deliberately dense — long-scroll, multiple feature blocks per band, marginalia and joke captions. 12-column grid, max width ~1280 px, but sections often break out with full-width banners. Product dashboard is more conventional — left nav + main content area.

## Depth & Elevation

The brand's signature is the offset hard shadow (`2-8px 2-8px 0 black`). It's used on buttons, cards, callouts, badges — anywhere the brand wants an element to feel "stickered onto the page". No soft drop shadows, no gradients. On hover the shadow snaps off and the element translates by the same offset, creating a satisfying tactile press.

## Do's & Don'ts

**Do**
- Use the cream `#EEEFE9` background as the canvas; pure white feels off-brand.
- Apply the hard offset shadow (`4px 4px 0 #000`) to interactive elements.
- Embrace dense, copy-rich layouts with marginalia and jokes.
- Pair primary blue CTAs with bright orange/yellow/green decorative accents.
- Include a hedgehog illustration somewhere if it fits — the mascot is integral.

**Don't**
- Use soft drop shadows or gradients; the brand is hard-edged.
- Sanitize the voice — PostHog is irreverent.
- Use thin (1 px) borders on primary chrome — borders are 1.5-2 px black.
- Use a pure white background; cream is the brand canvas.
- Center everything; the brand layouts are intentionally asymmetric.

## Responsive Behavior

Below ~960 px the dense multi-column marketing bands collapse to a single column with offset shadows scaling down (`4px → 2px`). Marginalia jokes either inline into the body flow or get pruned. The dashboard sidebar collapses behind a hamburger; tables become horizontally scrollable. Hedgehog illustrations rescale with their compositions intact rather than reflowing.

## Agent Prompt Guide

When asked to design "in the style of PostHog":
1. Start from the cream `#EEEFE9` canvas with white cards and 1.5-2 px black borders.
2. Apply hard offset shadows (`4px 4px 0 #000`) to interactive elements; snap them off on hover.
3. Set type in Matter (or Inter) — 700 weight headlines, 400 body, dense copy with marginalia.
4. Use blue primary CTAs with secondary accents in orange, yellow, or green.
5. Add a small hand-drawn hedgehog or signpost illustration if the section has room.

---
*Inspired by PostHog. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
