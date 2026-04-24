# Visual taste guidelines (anti-slop)

These rules encode the difference between a design that looks generated and one that looks considered.

## Typography

**Forbidden fonts** (overused to the point of invisibility):
- Inter, Roboto, Arial, Helvetica, Playfair Display (unless explicitly requested)

**Preferred alternatives** (expressive, distinct, free via Google Fonts):
- Display / editorial: Fraunces (bundled), Syne, DM Serif Display, Instrument Serif, Space Grotesk
- Clean sans: Geist (bundled), Outfit, Plus Jakarta Sans, Neue Montreal (system-ui fallback)
- Mono accents: JetBrains Mono, Fira Code (use sparingly, for data or code)

**Required type ladder** — every design declares four scale steps and uses them consistently:
- `display` (48–96 px) — single hero word or headline; tight tracking; serif for editorial types
- `h1` (28–40 px) — section openers
- `body` (16–18 px) — prose, list items, card content
- `caption` (12–14 px, uppercase or muted) — labels, eyebrows, source lines

Skipping a step (e.g. body that jumps straight to display with no h1 in between) reads as flat and is forbidden.

Typography rules:
- Mix weights deliberately: one very heavy line (700–900) anchors hierarchy; body at 400; captions at 400 with reduced opacity.
- Use `letter-spacing: -0.02em` on large headings (36 px+). Tight tracking reads as confident.
- Never center-align body paragraphs. Center alignment is for short headlines and CTAs only.
- Line length: 60–75 characters for body text. Use `max-width: 65ch` on prose containers.

## Color

- Use oklch color space for accent colors. oklch gives perceptually uniform chroma — a color and its 20% lighter variant will feel proportionally related, unlike hex math.
  - Example: `oklch(62% 0.22 265)` (blue-violet), `oklch(72% 0.18 40)` (warm amber)
- Avoid pure black (`#000`) for text. Use near-black with a slight hue cast: `oklch(12% 0.01 265)`.
- Do not use the default Tailwind blue (`#3b82f6`). It signals "this is an uncustomized Tailwind design."
- Do not lean on default Tailwind grays (`gray-50`…`gray-900`) as the entire neutral scale. Tilt them warm (oklch hue 60–90) or cool (oklch hue 240–270) so the surface has a temperature.
- Accent palette: one primary accent, optionally one complementary plus one positive / success tone. Three or more accent colors indicates lack of restraint.
- Background: off-white or very light warm neutral (`#f8f5f0`, `oklch(97% 0.005 80)`) almost always beats pure white.

### Dark themes specifically

Dark does not mean monotone. A dark design that is one near-black plus one accent reads as a default Tailwind dark mode and is the canonical sparse-LLM look. Required when the brief asks for dark:

- At least three distinct surface tones: page bg (`oklch(14% 0.01 265)`), elevated surface (`oklch(18% 0.01 265)`), inset surface or hairline divider tone.
- A subtle gradient or radial glow on the hero or one feature panel — never a flat fill end-to-end.
- Two accents minimum: one primary (saturated), one positive / data-positive (e.g. cyan, lime, or warm amber for delta indicators).
- Borders rendered as `1px solid oklch(28% 0.01 265)` or similar, never `border-gray-800`.

## Layout

- Prefer **asymmetry** over perfect bilateral symmetry. A 7:5 split column feels more alive than 6:6.
- Vary section heights. A 3-section page where every section is the same height looks like a slideshow.
- Use negative space as a design element, not as leftover space. A single large headline on 30vh of white is a design choice.
- Avoid the "three features in a row with icon + title + text" pattern unless you add a distinctive twist (unusual icon treatment, color band, staggered layout).

## Motion

- CSS-only: `transition: color 120ms ease, background 200ms ease`. No JS loops.
- Hover states: subtle, not dramatic. `opacity: 0.85` or `translateY(-2px)` — not scale + shadow + color simultaneously.
- Page-level animation: `@keyframes` fade-in on `<main>` at 150ms is enough. No scroll-triggered choreography.

## Texture and depth

- Grain overlay: a `0.03` opacity SVG noise filter or CSS `url()` feTurbulence adds tactile quality to flat surfaces. Use on hero backgrounds, not everywhere.
- Glass: `backdrop-filter: blur(12px)` cards look modern when used once. Used everywhere, they look like a tutorial.
- Borders: prefer `1px solid oklch(85% 0.01 0)` (slightly warm gray) over stark `border-gray-200`.

## Content quality signals

- Photographs: inline SVG abstract compositions or CSS gradient fills. Never hotlinked placeholder images.
- Data visualizations: hand-coded SVG bar charts or sparklines, not fake progress bars at suspiciously round percentages.
- Icon weight: match the overall design weight. Light design = 1.5px stroke icons. Heavy design = filled icons.

## What "slop" looks like (avoid)

- A hero section with a gradient blob background, bold sans headline, and a generic screenshot mockup.
- A features section with six 1:1 cards, each with a 24px icon, a two-word title, and a sentence of filler text.
- A testimonials section with circular avatars, a name, a title, and a five-star rating.
- A footer with three columns of nav links and a social media icon row.
- A "minimal dark" page that is `#0E0E10` end-to-end with a single purple accent and four sparse stat cards. This is the prototypical sparse-LLM output — sections feel like placeholders, the hierarchy is flat, and the only visual interest is the accent color. Always add: a hero with a real headline + subhead, at least one body / narrative section, a comparison or evidence block when numbers are involved, and a closing CTA.
- A "case study" that is four metric cards plus a single quote — this misses the hero, the before/after, the customer profile, and the closing. See the case_study density floor in the artifact-types section.
- A logo placeholder rendered as a soft-rounded square with a single random letter centered inside. Use a constructed monogram, a wordmark, or an explicit hatched "YOUR LOGO HERE" rectangle instead.
- Decorative emoji used as section icons unless the brief explicitly asks for emoji.
- Lorem ipsum, "John Doe", "Acme Corp", "100%" / "1,234" round-number filler.

These patterns are not forbidden — they are forbidden when combined without a distinctive visual angle that makes them feel intentional rather than assembled from a component kit.
