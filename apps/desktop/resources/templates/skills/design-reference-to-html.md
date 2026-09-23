---
schemaVersion: 1
name: design-reference-to-html
description: >
  Recreates an existing visual reference, such as a UI screenshot, mockup export,
  Figma frame image, dashboard, SaaS screen, empty state, or landing-page capture,
  as high-quality HTML/CSS or App.jsx. Use only when the user provides a concrete
  visual reference, not for text-only page design.
aliases: [design-to-html, screenshot-to-html, visual-reference, screenshot-recreate]
dependencies: [responsive-layout]
validationHints:
  - visual reference is mapped before code is written
  - complex brand or illustration assets are treated as assets, not improvised CSS
  - preview screenshots are compared against the reference before done
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Design Reference Recreation

Use this workflow when the user asks to recreate, copy, convert, or implement a
visible design reference as HTML/CSS, `App.jsx`, or a local web artifact.

Do not use it for ordinary product design from prose. If there is no screenshot,
mockup, exported frame, or equivalent visual artifact, use normal frontend
design judgment instead.

## Core Contract

Do not jump straight from image to code.

Work as an error-reduction loop:

1. Inspect the visual reference and build a compact page map.
2. Separate code-rendered UI from external visual assets.
3. Decide the reference canvas, target viewport, and scaling strategy.
4. Implement structure first, then visual polish.
5. Run `preview(path)` and inspect the rendered result.
6. Compare the preview screenshot against the reference by region.
7. Correct concrete visual differences and preview again before `done(path)`.

## Inputs To Establish

Infer these from the prompt, attachments, workspace files, and `inspect_workspace`
when possible. Ask only when missing information would change the output format
or fidelity target.

- Visual reference: screenshot, mockup export, frame image, browser capture, or
  local reference asset.
- Output surface: default to `App.jsx` in an Open CoDesign workspace; use
  standalone `.html` only when requested or when editing an existing HTML file.
- Reference canvas: preserve the image aspect ratio when dimensions are known.
- Verification viewport: match the reference size when practical, then also
  check the user-facing viewport if different.
- Asset availability: logos, illustrations, product screenshots, device renders,
  photos, icon sets, or only the flat reference image.
- Responsive scope: desktop-only unless the user requests mobile/tablet or the
  existing artifact clearly needs breakpoints.

## Page Map Before Code

Before writing source, make a short implementation map:

- Overall regions: header, sidebar, hero, content grid, panels, footer, overlays.
- Layout ratios: column widths, row heights, primary alignment, visible margins.
- Component inventory: visible UI pieces in top-to-bottom, left-to-right order.
- Color and surfaces: background, cards, borders, shadows, accent colors.
- Typography: heading/body/helper sizes, weights, line-height, casing.
- Shape and density: radius scale, padding rhythm, gaps, shadow softness.
- Asset candidates: logos, photos, screenshots, illustrations, 3D objects,
  detailed empty-state art, or brand key visuals.

Keep the map concise. It is a checklist for implementation, not a long critique.

## Asset Separation

Render with HTML/CSS:

- Navigation, sidebars, tabs, menus, cards, panels, forms, tables, buttons,
  labels, badges, dividers, text, simple charts, and simple icons from an
  existing icon library.

Treat as assets:

- Brand logos and marks.
- Detailed illustrations, hero art, 3D renders, people photos, textures.
- Product screenshots, app mockups, detailed empty-state images.
- Any shape where exact brand detail matters more than layout structure.

If removing an element leaves the UI skeleton intact, it is probably an asset.
If removing it breaks the page structure, it is probably code-rendered UI.

Do not hand-draw logos or complex illustrations with ad hoc CSS/SVG. Prefer, in
order:

1. Existing user-supplied assets in the workspace.
2. A cropped asset from the reference, when available and clear enough.
3. A stable neutral placeholder that preserves layout.
4. `gen_image(prompt, path)` only when the user asked for generated/redrawn
   bitmap assets and the current provider supports it.

Report placeholders and low-quality crops in the final summary.

## Canvas And Fit

For screenshot recreation, distinguish:

- Reference canvas: the design image/artboard being copied.
- Display viewport: the browser or preview size used to inspect the result.

Standalone visual reproductions should preserve the reference aspect ratio.
Use an outer shell plus a stable stage rather than scattering viewport math
through every element:

```css
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
}

.preview-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--page-bg);
}

.design-stage {
  width: min(100vw, calc(100vh * var(--reference-ratio)));
  max-height: 100vh;
  aspect-ratio: var(--reference-ratio);
  position: relative;
  overflow: hidden;
}
```

Define `--page-bg` and `--reference-ratio` in the artifact stylesheet before
using this pattern. For a 1440 by 900 reference, `--reference-ratio` is
`1440 / 900`.

Use a normal responsive layout for production app screens, but still preserve
the reference proportions at the target breakpoint before adding other
breakpoints.

Avoid direct `transform: scale(...)` on a centered fixed canvas unless a parent
frame also reserves the scaled layout size. Otherwise the visual canvas and the
layout box disagree, which causes clipped edges or large empty bands.

## Build Rules

- Match proportions and alignment before tuning shadows or gradients.
- Use CSS variables for repeated colors, spacing, typography, radius, and
  shadows; update `DESIGN.md` when the reference establishes a reusable system.
- Use explicit dimensions, `aspect-ratio`, grid tracks, `object-fit`, and
  min/max constraints for repeated units and asset slots.
- Keep text content faithful to the reference. Do not add visible explanatory
  labels unless the reference shows them.
- Prefer local assets and app-provided libraries. Do not install packages,
  download images, or add external hotlinks without user approval.
- Use the repo's existing framework and source entry. In Open CoDesign, default
  to `App.jsx`; reserve `index.html` for standalone exports or existing HTML
  workspaces.

## Preview And Compare

Always run `preview(path)` before `done(path)` when the preview tool is
available. Inspect:

- Canvas fit: no unintended crop, squeeze, overflow, or corner anchoring.
- Region layout: header, sidebar, main content, repeated cards, footer.
- Typography: hierarchy, wrapping, weight, line-height, and text color.
- Surfaces: background hue, card contrast, border opacity, radius, shadows.
- Assets: size, crop, aspect ratio, resolution, and style match.
- Density: gaps, padding, vertical rhythm, and whether the page feels too empty
  or too cramped.
- Responsive behavior when mobile/tablet is in scope.

Convert vague visual mismatch into actionable edits:

- "Hero starts about 24px too low."
- "Cards need 8px less vertical padding."
- "The sidebar is too wide relative to the reference."
- "The product screenshot slot should use `object-fit: contain`, not stretch."

Iterate with focused edits, preview again, then stop when remaining differences
are minor, blocked by missing assets, or outside the requested scope.

## Delivery

When calling `done(path)` and summarizing for the user, include:

- What file or artifact was implemented.
- Which reference and viewport were checked.
- Which assets were used, cropped, generated, or represented by placeholders.
- Remaining visual gaps or unverified assumptions.

Do not claim pixel-perfect fidelity unless preview comparison supports it.
