---
name: Shopify
slug: shopify
category: E-commerce
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Shopify. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#008060"
  secondary: "#1A1A1A"
  background: "#FFFFFF"
  surface: "#F6F6F7"
  text: "#1A1A1A"
  muted: "#6D7175"
  border: "#E1E3E5"
  accent: "#008060"
  marketingGreen: "#004C3F"
  warning: "#FFD79D"
  critical: "#FED3D1"
  highlight: "#FFEA8A"

typography:
  display:
    fontFamily: "ABC Diatype, Inter Display, Inter, system-ui, sans-serif"
    weight: 600
    lineHeight: 1.05
    letterSpacing: "-0.022em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "-0.005em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 20, 24, 32, 48, 64, 96]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"

shadows:
  sm: "0 1px 0 rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.06)"
  md: "0 4px 12px rgba(0,0,0,0.08)"
  lg: "0 16px 32px rgba(0,0,0,0.12)"

motion:
  duration:
    fast: "150ms"
    normal: "240ms"
    slow: "400ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Shopify operates two distinct visual languages. The marketing site (shopify.com) is bold, editorial, and merchant-celebrating — featuring large photography of small-business products and owners, big headlines, and the signature `#008060` brand green. The product (Polaris design system) is calm, dense, businesslike — a flat near-monochrome admin UI with the same green accent.

The brand believes in being merchant-first; everything on marketing celebrates the people running stores.

## Color Palette & Roles

- `primary` (`#008060`) — Shopify green; primary CTAs and brand chrome.
- `marketingGreen` (`#004C3F`) — deeper forest green; full-bleed marketing hero bands.
- `text` (`#1A1A1A`) — near-black; primary copy.
- `background` (`#FFFFFF`) — white in default surface.
- `surface` (`#F6F6F7`) — pale gray section bands and admin sidebar background.
- `muted` (`#6D7175`) — secondary copy.
- `border` (`#E1E3E5`) — hairline.
- `warning` / `critical` / `highlight` — status banner backgrounds in the admin (peach, salmon, lemon).

## Typography

Marketing uses ABC Diatype (Dinamo) for headlines; Polaris uses Inter throughout. Display weight 600, -0.022em tracking, 1.05 line-height. Body weight 400, 1.5 line-height.

Hierarchy: hero (56-72 px on marketing, 28-36 px in admin) → section (24-32 px) → body (14-16 px) → caption (12-13 px). Numerals are tabular for prices, inventory counts, analytics.

## Components

- **Buttons (marketing)**: pill or rounded-md, 44-48 px height, primary green-on-white or white-on-forest-green.
- **Buttons (Polaris admin)**: 28-36 px height, 6 px radius, primary solid green with subtle shadow lift; secondary white with 1 px border.
- **Cards (Polaris)**: rounded-lg (12 px), white with hairline border and `sm` shadow; section dividers within the card.
- **Status banners**: peach/salmon/lemon backgrounds with 1 px border in matching tone, icon + headline + body.
- **Inputs**: 36 px height, 6 px radius, 1 px border, brightens to green with 2 px halo on focus.
- **Tables**: dense rows, hairline dividers, mono on SKUs and IDs, tabular numerals on quantities and prices.

## Layout

Marketing: 12-column grid, max width ~1280 px, generous section padding (96-128 px). Admin (Polaris): fluid layout with a left nav (~240 px), main content cards, and section sidebars on detail pages. Admin is information-dense but never crowded.

## Depth & Elevation

Polaris uses a small but real shadow language: cards get a subtle 1 px hairline + 1 px drop shadow, buttons get a 1 px bottom-bevel shadow that lifts on press. Modals use `md` shadow on a dimmed backdrop. Marketing leans on photography and large color blocks for depth rather than shadow.

## Do's & Don'ts

**Do**
- Anchor on Shopify green (`#008060`) primary CTAs against white or forest-green backgrounds.
- Set marketing display in ABC Diatype (or Inter) at weight 600, tight tracking.
- Build admin (Polaris) with rounded-lg cards, dense rows, hairline borders, soft shadow lift.
- Use peach/salmon/lemon status banners with matching tone borders.
- Show prices and inventory in tabular numerals.

**Don't**
- Mix marketing scale into the admin (admin uses 14-16 px body, modest controls).
- Decorate Polaris with gradient fills or glows.
- Use a second accent color in admin chrome — green does the work.
- Square corners on cards or buttons; the brand is rounded.
- Use pure black for text — `#1A1A1A` is the brand value.

## Responsive Behavior

Marketing collapses 12-column bands to single column at ≤ 768 px; hero headlines drop from ~72 px to ~36 px. Admin is desktop-first but supports a mobile shell — left nav collapses behind hamburger, cards stack full-width with reduced internal padding. Tables become horizontally scrollable rather than reflowing. Status banners retain their full structure on every breakpoint.

## Agent Prompt Guide

When asked to design "in the style of Shopify":
1. Decide marketing (bold, editorial, photography-led) or admin (Polaris, dense, calm).
2. For marketing: use forest-green hero bands, ABC Diatype or Inter at weight 600, large product/merchant photography.
3. For admin: rounded-lg (12 px) cards on `surface` (`#F6F6F7`), Inter 14-16 px body, soft 1 px lift shadow.
4. Anchor every page on Shopify green (`#008060`) primary CTAs.
5. Use peach/salmon/lemon banners for status messages with matching-tone borders and icons.

---
*Inspired by Shopify. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
