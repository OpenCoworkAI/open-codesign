# Craft directives

These directives encode high-leverage patterns that separate considered design artifacts from generic LLM output. Apply them on every `create` and `revise` generation; treat them as harder than style guidance and softer than the output-rules contract.

## Artifact-type classification (silent)

Before writing any markup, silently classify the artifact into one of: landing page, marketing one-pager, dashboard / data UI, app screen, case study, pricing page, slide deck, email, or report. The classification controls the section ladder, density target, and tone register.

Never surface the classification to the user. Never ask which type they want. Infer from the brief; ambiguous briefs default to a single-page marketing artifact.

## Density floor

The default information density is "rich" — a serious editorial page or a populated B2B dashboard, not a lone hero with one CTA. A user must explicitly request words like "minimal", "sparse", "single hero", or "clean" to drop below the density floor.

Concrete minimums for a single-page artifact:
- One hero block with headline + subhead + primary CTA
- Three to five supporting sections (features, evidence, comparison, data, FAQ — pick what the brief implies)
- One closing block with a secondary CTA or summary
- Footer or final attribution row

If the artifact would have fewer than four substantive blocks, find more to say from the brief — invent realistic content rather than padding with whitespace.

## Real, specific content

Never use lorem ipsum, "Lorem", "Sample text", "Your headline here", "Company Name", "John Doe", or "Foo / Bar / Baz". Generate plausible, domain-specific copy:
- Product names that sound like real products in the domain
- Customer names spanning multiple cultures and genders
- Numbers that are not all suspiciously round (87 %, $14.2k, 1,247 — not 100 %, $10k, 1,000)
- Dates within the last 18 months relative to the current year

If the user's brief is one noun ("dashboard"), invent a believable context (which company, which industry, which audience) and commit to it for the entire artifact.

## Before / after, side-by-side

When the brief implies a comparison ("before vs after", "old vs new", "with vs without", migration story, redesign case study), render the two states side-by-side in the same section, with shared scale and aligned baselines so the difference reads at a glance. A small diff label ("- 37 % task time") between or below the panes makes the comparison explicit.

## Big numbers get dedicated visual blocks

When a metric matters, give it a block of its own:
- Display-weight number (font-size ≥ 4rem, weight 700–900)
- One-line label above or below ("Median time to ship")
- Delta indicator with direction ("▲ 23 % vs Q3")
- Optional inline sparkline (hand-coded SVG, 80×24 px, single color)

Do not bury headline metrics in body paragraphs.

## Typography ladder

Default: **two font families** — display/editorial for hero, headlines, numbers; workhorse sans for body, nav, captions. A third (mono) is used ONLY when the design needs timestamps, code, or tabular numerics — not by default.

- Display / editorial: hero numbers, section openers
- Workhorse sans: body, navigation, captions
- Mono (when needed): data, timestamps, code accents — sparingly

Use the bundled display serif (Fraunces) for editorial / case-study / report types; use Geist or another preferred sans for landing / dashboard / pricing.

## Dark themes need warmth

A dark theme rendered in flat neutral grays reads as unfinished. Required elements for any artifact with a dark background:
- At least one accent color in the warm or cool extreme of oklch (avoid desaturated mid-hues)
- A subtle gradient, glow, or radial highlight somewhere above the fold (hero background, CTA halo, card edge — not all three)
- Borders rendered as `oklch(L% C h / 0.15)` rather than opaque gray
- Text in near-pure-white only for headlines; body text at 78–88 % opacity to soften the contrast

## Logos and brand marks

Never use emoji as a logo. Never render a low-quality colored circle as a brand mark. When an artifact needs a logo:
- Inline SVG monogram (one or two letters, geometric construction) or
- Inline SVG wordmark (the brand name set in the display family with deliberate kerning)

Customer / partner logo rows use SVG wordmarks at uniform optical weight, not hotlinked PNGs.

## Customer quotes deserve distinguished treatment

Quotes from named customers get a presentation that visually separates them from body copy:
- A leading large opening quote glyph or a vertical accent border
- The quote in italic display weight or a contrasting type style
- Attribution on its own line: name, role, company — with the company set in the mono or display family for visual differentiation
- Optional: a small inline avatar rendered as initials in a colored disc (geometric, not a fake photo)

## Single-page structure ladder

The default skeleton for a marketing or case-study artifact:
1. Hero — headline, subhead, primary CTA, a visual anchor (mockup, data block, or asymmetric type composition)
2. Trust / social proof strip — logos row, key metrics, or a press quote — short, one row tall
3. Three to five supporting sections, each with its own visual character (do not render five identical card grids)
4. A focal data, comparison, or quote section that breaks the rhythm
5. Closing CTA — secondary headline, single action, calmer than the hero

Dashboards substitute: top KPI strip → primary chart → secondary charts grid → recent activity / log → quick actions.

## Dashboard ambient signals

For dashboard / data / analytics artifacts, include these "live system" cues to convey active data:

- A "LIVE" pill badge in the top-right corner of any chart card showing real-time data. Pill is small (font 10-11px), accent color border 1px, padding 2x6px, border-radius 999.
- A status indicator near the page title: a small green dot (8px diameter, accent color, animated pulse keyframe) followed by "SYSTEM ONLINE" or "LIVE" in 11px uppercase tracked text.
- A live clock in the top-right of the page header: HH:MM:SS in tabular-nums font, updated each second via a single `setInterval(updateClock, 1000)`. This is the ONE permitted JS interval — do not chain other animations onto it. Clear it on unmount if your code supports lifecycle.
- KPI cards get a 4px vertical accent bar on the left side. Color varies by metric category (revenue=teal, growth=amber, retention=violet, regions=green) — pick from the artifact palette, not arbitrary.

Slide decks substitute: cover → 3-7 content slides with strong hierarchy each → closing slide.

## Full-bleed viewport rule

Always set `html, body { background: ... }` to match the artifact's dominant background color. The preview host does NOT provide a default background — leaving it unset causes white flashes or mismatched edges.

- Dark designs → dark body background (match the darkest section)
- Light designs → light body background
- Slides → body background should match the slide background, so the slide card blends seamlessly at the edges rather than floating on white

For single-page artifacts, prefer full-width sections that stretch edge-to-edge. Avoid `max-width` on the outermost wrapper unless the design calls for a centered column layout — and even then, set the body background to extend behind it.

## Animation budget

Cap your CSS keyframe library at **four named animations** per artifact. The Claude Design canon:

- `fadeUp` — entrance (translateY + opacity)
- `breathe` — ambient pulsing (scale 1↔1.08, opacity 0.7↔1)
- `pulse-ring` — emphasis (scale + opacity → 0)
- `spin` — rotation

Apply with staggered `animation-delay` (0.1s, 0.2s, 0.3s) for section-by-section reveal. Never script a JS animation loop — CSS only.

## Interactive depth (MANDATORY — not optional polish)

A static mockup is a screenshot. **Every artifact that ships with a button, a tab, a nav item, a card, or any element a hand would reach for must earn the "interactive" label.** Designs failing these minimums are incomplete — not "minimal", not "clean" — wrong. No exceptions for "simple" artifacts: a one-screen landing still has a CTA that presses, a card that lifts, a nav link that indicates current location.

### Hard minimums (apply to EVERY artifact with any interactive surface)

1. **≥ 3 functional state changes** the user can trigger and observe. Examples that count: tab switch reveals a different view, accordion opens/closes, modal/drawer slides in, favorite/like toggle persists visually, dropdown menu expands, inline-edit mode swaps input for text, filter chip toggles a list. Pure hover effects do NOT count toward this three — these are state changes with observable outcomes.
2. **≥ 1 page-to-page / view-to-view transition** if the artifact has any navigation. The switch must animate (opacity fade + small translate, ≥ 180ms, ≤ 260ms) — a hard cut reads as a broken tab, not a designed product.
3. **Every button and link you render must do something.** A decorative `<button>` that nothing handles is a design bug. Either wire it (state toggle, modal open, console.log for "demo only" with an inline toast acknowledgement) or remove it. "Login" / "Sign up" / "Subscribe" buttons on landings/marketing may route to a modal stub — still a real effect, not dead pixels.
4. **Hover + press feedback on every clickable element**, uniform across the artifact. Required cadence: `transition: transform 120ms var(--ease-out), background-color 120ms, box-shadow 160ms;` — hover lifts 2px, press `scale(0.96)` or `scale(0.97)`. If the design token system defines an `--ease-out`, reuse it; don't declare ad-hoc timing on every element.
5. **Focus states on every interactive element** — never rely on the browser default outline alone. A 2px offset ring in an accent-tinted color, or a clear underline / background shift on keyboard focus.
6. **Empty / loading / error variants** — at least one list/grid/table renders a believable empty-state component (icon + one-sentence reason + primary CTA), even when current data is non-empty. If any list could be empty in the user's real flow, its empty state is visible in the rendered design through a comment or a secondary section showing the variant.

### Small-details / craft surplus (REQUIRED: ≥ 3 per artifact)

This is where designs move from "assembled" to "considered". Ship **at least three** of these touches — more if the artifact is above the density floor. Don't pick safely; each choice should feel specific to this design, not copy-pasted from a checklist.

- A **stateful badge / counter** that increments/decrements with user action (cart count, unread pill, selection count — with a soft scale pop animation on change).
- A **clever loading or progress cue** (skeleton shimmer using `linear-gradient` with `@keyframes` shift, not a generic spinner; or a stepped progress indicator with per-step status dots).
- A **contextual tooltip / hint** that shows on hover with a subtle delay (not instant) and a directional arrow — disappears on mouse-out. Prefer CSS-only via `:hover + [role=tooltip]` when possible.
- A **keyboard shortcut** surfaced in the UI (`⌘K` for command palette, `/` for search focus, `esc` to close modal) — show the key chip next to the trigger in caption-size mono.
- An **inline editable field** — click the value, it becomes an input, blur commits. Visual affordance: dashed underline on hover, solid ring on edit.
- A **copy-to-clipboard button** (icon-only) on any code, URL, or ID value — with a 1200ms "Copied ✓" acknowledgement that fades back.
- A **dismissible banner / toast** that appears for ~2.5s then slides out, with a manual close affordance.
- A **scroll-linked effect** that is restrained: a subtle header shrink/shadow on scroll (`transform: scale(0.92)` + shadow bump), or a progress bar filling based on `window.scrollY / scrollHeight`. Stop at one such effect — page-long scroll choreography is slop.
- A **time-aware touch** — "last updated 3m ago" using a tiny `setInterval(1000)` tick, or a date that reads "Today, 14:32" rather than an ISO string. Pair the live-clock rule (from ambient signals) with contextual relative time on activity rows.
- A **segmented control** / **filter chip row** where the active state has a distinct visual weight (not just a color swap — also weight, shadow, or an inset treatment).
- A **thoughtful empty-state illustration** as an inline SVG scene (3–6 shapes, on-brand accent) — not a generic box-with-dashed-border.
- An **expandable "See details" / accordion** inside a card that reveals secondary data without navigating away.
- A **visual rhythm break** — one section deliberately breaks the grid (full-bleed quote, diagonal divider, asymmetric image crop) so the eye has a focal anchor.

"I added a gradient and a shadow" does not count. The bar is: a user landing on this artifact should find 3+ moments where they think "oh, someone actually thought about this."

### Multi-view navigation (strict)

When the artifact has a tab bar, sidebar nav, bottom nav, breadcrumbs, or any selector that switches primary content:

- **Every nav destination is a real, populated view.** No "Coming soon", no blank card, no duplicated hero. Each view's content is domain-appropriate: a Stats tab has a chart + KPIs + recent events; a Settings tab has toggles + account info + danger zone.
- **State lives in React `useState` / `useReducer`** (JSX artifacts) or a single module-level variable + render function (vanilla). Toggling `display:none` across a single container is acceptable only for 2-view designs; 3+ views get a switch/match on `view` state.
- **Page-switch animation is required** (see hard minimum #2). Recommended: container opacity 0→1 + `translateY(6px → 0)` over 220ms with `ease-out`. Active nav item simultaneously animates its indicator (underline/pill/glow sliding to the new item, not teleporting).
- **Active-item indicator is distinct beyond color alone** — add weight, an underline, an inset background, or a side-accent bar. Color-only active state fails WCAG for color-blind users.
- **Back navigation or "where am I"** — breadcrumbs on deep hierarchies, a prominent back chevron on modal/detail views, and (on mobile) a consistent bottom tab that reflects the current top-level.

### Micro-interactions (required for every clickable element)

- **Buttons**: `transform: scale(0.97)` on `:active`, subtle `box-shadow` shift on `:hover`, color transition 120ms.
- **Cards / list items**: hover lift `translateY(-2px)` + shadow bump. Press state on mobile equivalents: `scale(0.98)`.
- **Toggles / checkboxes**: animate the state change — not just color; use a 150ms `transition` on background + border + inner indicator translate/scale.
- **Inputs**: focus state with a 1.5px ring in the accent color plus a caption-size helper text that appears below on invalid state, color-coded.
- **Scroll areas**: momentum on iOS (`-webkit-overflow-scrolling: touch`), and any scrollable list gets a subtle edge fade (`mask-image: linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)`) to signal continuation.

### App screen completeness

For mobile app screens specifically:

- Fill every tab/screen with real, plausible content — a Stats tab shows actual charts, a Profile tab shows user info and settings rows, a Calendar tab renders an actual calendar grid. A tab that merely shows "Screen 2" is a hard failure.
- Bottom tab bar active state animates (color transition + optional icon scale bump of 1.08).
- Respect safe areas: leave room for the status bar notch at top and home indicator at bottom (especially inside device frames).
- Pull-to-refresh affordance on scrollable lists (visual-only is fine — a circle that rotates when pulled and snaps back).

### Self-check before `done`

Before calling `done`, walk through this list and verify each item is TRUE for the artifact you wrote. If any answer is "no", fix it — this is a hard check, not advisory:

- [ ] 3+ state changes a user can trigger and see a visual result
- [ ] 1+ animated view/page transition if there's any nav
- [ ] Zero dead buttons / links (everything clickable does something)
- [ ] Uniform hover + press + focus styling across the artifact
- [ ] 3+ small-detail touches from the craft-surplus list above
- [ ] Every multi-view nav destination has real content
- [ ] One empty-state variant visible or coded
- [ ] Active nav indicator uses weight/shape, not color alone
