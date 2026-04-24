---
name: SpaceX
slug: spacex
category: Tech
license: MIT-attribution
source: VoltAgent/awesome-design-md
attribution: >
  Inspired by SpaceX. Tokens derived from publicly available CSS and
  press materials. Not affiliated with the brand owner.

colors:
  primary: "#FFFFFF"
  secondary: "#005288"
  background: "#000000"
  surface: "#0A0A0A"
  text: "#FFFFFF"
  muted: "#A7A7A7"
  border: "#1A1A1A"
  accent: "#005288"

typography:
  display:
    fontFamily: "D-DIN Condensed, D-DIN, DIN Condensed, Helvetica Neue Condensed, Inter, system-ui, sans-serif"
    weight: 700
    lineHeight: 1.0
    letterSpacing: "0.02em"
  body:
    fontFamily: "D-DIN, Helvetica Neue, Inter, system-ui, sans-serif"
    weight: 400
    lineHeight: 1.5
    letterSpacing: "0.005em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    weight: 400

spacing:
  unit: 4
  scale: [4, 8, 16, 24, 32, 48, 64, 96, 128, 192]

radius:
  none: "0"
  sm: "0"
  md: "0"
  lg: "0"
  full: "0"

shadows:
  sm: "none"
  md: "none"
  lg: "0 24px 48px rgba(0,0,0,0.50)"

motion:
  duration:
    fast: "150ms"
    normal: "320ms"
    slow: "600ms"
  easing:
    standard: "cubic-bezier(0.4, 0, 0.2, 1)"
    accelerate: "cubic-bezier(0.4, 0, 1, 1)"
    decelerate: "cubic-bezier(0, 0, 0.2, 1)"
---

## Visual Theme & Atmosphere

SpaceX.com is mission-control aesthetic: full-bleed black, large rocket photography or launch video, condensed uppercase headlines in DIN, and minimal navigation. The brand vibe is institutional engineering — closer to NASA documentation than a tech startup site. Pages are short, spare, and dramatic. The single nav bar floats over hero photography; hero text reads like a mission name.

Decoration is essentially absent. Type and photography do everything.

## Color Palette & Roles

- `primary` (`#FFFFFF`) — white; the only text color and primary CTA fill.
- `background` (`#000000`) — pure black; the canvas of every page.
- `surface` (`#0A0A0A`) — section bands.
- `text` (`#FFFFFF`) — primary copy.
- `muted` (`#A7A7A7`) — secondary copy, captions.
- `border` (`#1A1A1A`) — hairline (rarely visible).
- `accent` (`#005288`) — the deep navy/blue from the SpaceX wordmark; appears on the wordmark only.

The brand is rigorously achromatic on UI surfaces — color comes from rocket exhaust plumes, Earth horizons, and Mars renders.

## Typography

D-DIN (and D-DIN Condensed for headlines) is the brand face — a digital revival of the German DIN 1451 standard used on engineering drawings. Display weight 700, condensed, uppercase, slightly positive tracking (+0.02em), 1.0 line-height. Body D-DIN regular, 1.5 line-height. Inter Condensed or Helvetica Neue Condensed are fallbacks.

Hierarchy: hero (64-120 px / condensed / uppercase) → eyebrow (12-13 px / uppercase / tracked +0.1em) → body (15-16 px) → caption (12 px). Numerals are tabular for telemetry-style data.

## Components

- **Buttons**: rectangular (zero radius), 1 px white border, transparent background, white uppercase label tracked +0.1em. ~40-48 px height. Hover fills white with black text.
- **Hero text**: enormous condensed uppercase, often broken across lines for editorial pacing.
- **Mission cards**: full-bleed image with white uppercase title overlaid, no border, no shadow.
- **Inputs**: rectangular, 1 px white border, transparent fill — feels like cockpit instrumentation.
- **Tables / specs**: monospaced labels in `muted` smallcaps, white values; hairline dividers.

## Layout

Single-column hero-focused pages. Max content widths sit around 1280 px when content needs reading width, but most pages are full-bleed. Section padding is generous (96-192 px). Pages are short — often a single hero image with a caption and one CTA.

## Depth & Elevation

The brand is uncompromisingly flat. There is no drop shadow language at all in default chrome. Elevation arises only from photography (depth-of-field, atmospheric haze) and from videos of launches. UI chrome lives on hairline borders; modals, when used, cover the screen rather than floating.

## Do's & Don'ts

**Do**
- Default to pure black with white type and rocket/space photography.
- Set hero text in D-DIN Condensed (or any condensed sans), uppercase, tracked +0.02em, weight 700.
- Use rectangular buttons with 1 px white border and transparent fill.
- Be generous with vertical space and keep pages short.
- Use uppercase eyebrow labels above section heads.

**Don't**
- Round any corners — the brand is rectilinear.
- Add color anywhere outside the wordmark.
- Decorate with gradients, glows, or shadows.
- Use a serif typeface; D-DIN/condensed-sans is the language.
- Stack multiple CTAs in a hero — one is enough.

## Responsive Behavior

Photography retains its full-bleed crop at every breakpoint. Below 960 px hero text drops from ~120 px to ~40 px while keeping uppercase condensed proportions. Section padding compresses from 192 to 48 px. Specifications tables collapse to label-above-value pairs. The thin top nav becomes a hamburger at ≤ 768 px.

## Agent Prompt Guide

When asked to design "in the style of SpaceX":
1. Build full-bleed black canvases anchored on rocket or space photography.
2. Set hero text in a condensed sans (D-DIN, Inter Condensed, Helvetica Neue Condensed), uppercase, weight 700, +0.02em tracking, 64-120 px on desktop.
3. Use rectangular buttons (zero radius), 1 px white border, transparent fill, uppercase tracked label.
4. Avoid color, shadows, gradients, and rounded corners entirely.
5. Keep the page short — one hero, one CTA, optionally one specifications block below.

---
*Inspired by SpaceX. Tokens derived from publicly available CSS / press
materials. Not affiliated with brand owners. Source structure based on
[VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) (MIT).*
