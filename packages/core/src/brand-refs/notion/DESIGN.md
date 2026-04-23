---
name: Notion
slug: notion
category: Productivity
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Notion. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#000000"
  secondary: "#37352F"
  background: "#FFFFFF"
  surface: "#F7F6F3"
  text: "#37352F"
  muted: "#787774"
  border: "#E9E9E7"
  accent: "#2383E2"
  highlightYellow: "#FBF3DB"
  highlightBlue: "#DDEBF1"
  highlightPink: "#FAE4E4"
  red: "#E03E3E"
  green: "#0F7B6C"

typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    weight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "-0.003em"
  mono:
    fontFamily: "iA Writer Mono, JetBrains Mono, ui-monospace, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128]

radius:
  none: "0"
  sm: "3px"
  md: "6px"
  lg: "10px"
  full: "9999px"

shadows:
  sm: "rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.10) 0 2px 4px"
  md: "rgba(15,15,15,0.05) 0 0 0 1px, rgba(15,15,15,0.10) 0 4px 12px"
  lg: "rgba(15,15,15,0.10) 0 14px 28px, rgba(15,15,15,0.10) 0 10px 10px"

motion:
  duration:
    fast: "100ms"
    normal: "200ms"
    slow: "320ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Notion looks like a paper notebook rendered in software. The aesthetic is warm-neutral — off-white background, brown-ish near-black text (`#37352F`), and ivory surface tones. The brand wordmark is a serif-leaning geometric, but the product is set in Inter. Iconography is monoline and slightly playful (the famous emoji-as-page-icon convention).

Marketing pages favor large playful illustrations — line drawings of objects floating in space, hand-drawn arrows, friendly emoji.

## Color Palette & Roles

- `primary` (`#000000`) — brand wordmark; rarely used in chrome.
- `text` (`#37352F`) — warm near-black for body copy; the brand never uses pure black.
- `surface` (`#F7F6F3`) — warm off-white sidebar tone.
- `border` (`#E9E9E7`) — almost-invisible hairline.
- `accent` (`#2383E2`) — Notion blue; used for links and the rare callout.
- `highlightYellow` / `highlightBlue` / `highlightPink` — pastel block backgrounds for callouts; restrained pastel palette.
- `red` (`#E03E3E`) / `green` (`#0F7B6C`) — text color options for inline highlights.

## Typography

Inter is the workhorse. Display at 700 weight, ~1.2 line-height; body at 400, ~1.5 line-height. The brand wordmark uses a custom geometric face, but it does not appear inside the product.

Hierarchy uses three heading levels (H1 30px, H2 24px, H3 20px) and a single body size. Mono is reserved for inline `code` and code blocks. Page titles often pair with a leading emoji or icon — type sits on a baseline with the icon visually anchoring the line.

## Components

- **Buttons**: 28-32 px height, 3-6 px radius. Primary: dark gray fill with white text; secondary: text-only on hover background.
- **Blocks**: every content unit is a block — paragraph, heading, callout, toggle. Blocks expose a 6-dot drag handle on hover at the left margin.
- **Sidebar items**: 28 px tall, hover background `surface` darkened by 4%, icon + label, no border separators.
- **Inputs**: borderless by default; 1 px border on focus.
- **Callouts**: pastel background block (yellow/blue/pink), 1 px subtle border, optional emoji icon in the top-left.
- **Modals**: 480-720 px wide, 6 px radius, soft `md` shadow.

## Layout

Pages are document-shaped: a single content column ~720-900 px wide with optional cover image and icon. Sidebar is 240 px (collapsible). Marketing pages use a 12-column grid with max width ~1140 px. Vertical rhythm is generous around blocks (8-12 px between, 24-32 px around headings).

## Depth & Elevation

Notion is essentially flat. Elevation is reserved for dropdown menus, modals, and toasts — using the signature double shadow (1 px hairline + soft drop). Inline blocks never lift; selection state uses a faint blue background fill instead. Marketing illustrations introduce depth through layered cut-out objects rather than UI shadow.

## Do's & Don'ts

**Do**
- Use warm neutrals — text `#37352F` on `#FFFFFF` background, never pure black on white.
- Lead pages with an emoji or icon + cover image pairing.
- Reserve callout pastels (yellow/blue/pink) for callout blocks only.
- Show drag handles on hover at the left of every block.
- Use Inter throughout the product; the wordmark serif stays in marketing.

**Don't**
- Use pure black (`#000000`) for body copy.
- Stack heavy borders or shadows on inline content.
- Add color to UI chrome — keep accents to the rare blue link.
- Reflow content into multi-column layouts; Notion is single-column.
- Use cool grays — the palette is warm.

## Responsive Behavior

Below ~960 px the sidebar collapses behind a top-left menu icon; below ~640 px the content column reduces side padding from 96 to 24 px. Block drag handles disappear on touch devices in favor of a long-press menu. Cover images scale to fill the viewport width; emoji icons stay at 78 px regardless.

## Agent Prompt Guide

When asked to design "in the style of Notion":
1. Anchor on warm neutrals: `#FFFFFF` background, `#37352F` text, `#F7F6F3` sidebar.
2. Keep content in a single document column (~720 px) with generous side padding.
3. Lead the page with an icon or emoji + an optional cover image.
4. Use Inter at 400 for body, 700 for headings, with comfortable 1.5 line-height.
5. Reserve color for pastel callout blocks and the rare blue link; everything else is grayscale.

---
*Inspired by Notion. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
