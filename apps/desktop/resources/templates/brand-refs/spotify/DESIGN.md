---
name: Spotify
slug: spotify
category: Media
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by Spotify. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#1DB954"
  secondary: "#1ED760"
  background: "#121212"
  surface: "#181818"
  surfaceRaised: "#282828"
  text: "#FFFFFF"
  muted: "#B3B3B3"
  border: "#2A2A2A"
  accent: "#1ED760"
  black: "#000000"

typography:
  display:
    fontFamily: "Spotify Circular, Circular, Inter, system-ui, sans-serif"
    weight: 900
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Spotify Circular, Circular, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 12, 16, 24, 32, 48, 64, 96]

radius:
  none: "0"
  sm: "4px"
  md: "8px"
  lg: "16px"
  full: "9999px"

shadows:
  sm: "0 2px 4px rgba(0,0,0,0.30)"
  md: "0 8px 24px rgba(0,0,0,0.50)"
  lg: "0 16px 48px rgba(0,0,0,0.70)"

motion:
  duration:
    fast: "120ms"
    normal: "200ms"
    slow: "320ms"
  easing:
    standard: "cubic-bezier(0.3, 0, 0, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

Spotify is dark, bold, and unapologetically loud. The background is near-black; album artwork supplies most of the color. Hero playlist headers extract the dominant color from the cover image and bleed it into a top-down gradient — a signature move that makes every page feel custom-tinted without any extra design work.

Type is heavy (900 weight Circular) at large sizes and light at small sizes; the contrast is dramatic. The brand-green pill CTA ("Play") is the single most identifiable element.

## Color Palette & Roles

- `primary` (`#1DB954`) — the original Spotify green; brand wordmark and accent.
- `secondary` (`#1ED760`) — a brighter green used for primary CTAs and hover states.
- `background` (`#121212`) — near-black canvas for all product surfaces.
- `surface` (`#181818`) — sidebar and card backgrounds; barely lifts off background.
- `surfaceRaised` (`#282828`) — hover state on cards, modals.
- `text` (`#FFFFFF`) — primary copy.
- `muted` (`#B3B3B3`) — secondary copy, metadata.

Album artwork color drives the rest of the palette dynamically. The static palette is intentionally tiny.

## Typography

Spotify Circular (custom Circular variant) is the brand face. Display weights jump from 400 to 700/900 — the brand loves heavy display type. Hero headlines on playlists hit 96-128 px in 900 weight.

Hierarchy: hero (96-128 px / 900) → section heading (24-32 px / 700) → body (14-16 px / 400) → caption (12 px / 400 in `muted`). Numerals are tabular in track listings.

## Components

- **Play button**: primary CTA — `secondary` green pill or circle, ~56 px, no border, scales up on hover.
- **Buttons**: pill-shaped (rounded-full), 32-48 px height. Primary green; secondary white outline; tertiary text-only in `muted`.
- **Cards**: 8 px radius, `surface` background, lift to `surfaceRaised` on hover.
- **Track rows**: 56 px tall, hover background `surfaceRaised`, image + title/artist + duration columns.
- **Sidebar items**: 40 px tall, icon + label, active state shows white text and a subtle vertical bar.
- **Tags / chips**: pill-shaped, `surface` background, 12 px text.

## Layout

App is a three-pane layout: 240 px left sidebar, fluid main, optional right "now playing" rail. Main view is a vertically scrolling stack of horizontal carousels (artist, album, playlist). Playlist pages start with a full-bleed hero (gradient extracted from cover art) followed by the track list table.

## Depth & Elevation

The product is dark and mostly flat, but uses gradient overlays heavily — playlist headers, "Made for You" hero cards. Elevation between cards is subtle (`surface` → `surfaceRaised` is only ~16 levels of brightness apart). Shadows are dark and soft; modals use `lg`. The "now playing" bottom bar floats above content with a soft top edge shadow.

## Do's & Don'ts

**Do**
- Default to dark mode; the brand has no real light theme.
- Use heavy 900-weight display type on playlist heroes.
- Pill-shape the primary play CTA in `secondary` green.
- Extract dominant color from cover art for hero gradients.
- Stack horizontal scrollable carousels for browse views.

**Don't**
- Use pure black backgrounds (`#000`) — Spotify uses `#121212`.
- Introduce additional brand colors; let cover art supply color.
- Square off the play button — it's always a circle or pill.
- Add icon decoration to track rows beyond play/heart/menu.
- Use dramatic shadows on inline cards — depth comes from background tone.

## Responsive Behavior

Below ~960 px the right "now playing" rail collapses; below ~768 px the left sidebar collapses behind a tab bar at the bottom (mobile pattern). Hero headlines scale from ~128 px to ~40 px; horizontal carousels remain horizontally scrollable rather than reflowing into vertical stacks. The bottom now-playing bar grows to a full-screen sheet on mobile.

## Agent Prompt Guide

When asked to design "in the style of Spotify":
1. Build dark: `#121212` background, `#FFFFFF` text, near-flat surface stack.
2. Lead the hero with a full-bleed gradient extracted from a cover image, plus a 96-128 px display headline at 900 weight.
3. Make the primary action a Spotify-green pill or circular play button (`#1ED760`).
4. Stack horizontal scrollable carousels for browse-style content.
5. Keep chrome minimal — let album art and bold typography do the work.

---
*Inspired by Spotify. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
