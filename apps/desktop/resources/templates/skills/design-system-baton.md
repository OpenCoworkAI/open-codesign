---
schemaVersion: 1
name: design-system-baton
description: >
  Clarifies when and how to create, repair, or update workspace DESIGN.md.
  Use for multi-screen work, brand adoption, reusable visual systems,
  componentized artifacts, or any task where colors, typography, spacing,
  radius, and component tokens must remain stable across outputs.
aliases: [design-md, design-system, baton, tokens, multi-screen-system]
dependencies: []
validationHints:
  - workspace DESIGN.md contains Google-compatible frontmatter and Overview
  - repeated visual choices are promoted to tokens instead of duplicated prose
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Boundary

`DESIGN.md` is the workspace design-system baton. It is not a prompt, not a
scratchpad, not a starter preset, and not a copy of a built-in brand reference.

Store stable palette, typography, spacing, component behavior, layout, and tone.
Record decisions future screens need, not tool logs or a second workflow.

## When To Create Or Update

Maintain `DESIGN.md` when the work establishes reusable choices:

- Multiple screens or artifacts share a visual language.
- A brand reference or user-provided design system is adopted.
- You introduce reusable components, shared tokens, or a named visual direction.
- Existing source already uses stable tokens that should guide the next pass.
- The host requires it for substantive work or multiple design sources.

For a small local revision, preserve the existing baton rather than restarting
design-system work. A tiny throwaway mock needs no invented system unless the
host explicitly requires one.

## Minimum Google-Compatible Shape

This compact example is valid under the app's `validateDesignMd` contract.
Adapt its values to the actual design; they are sample tokens, not brand data.

```md
---
version: alpha
name: Sample Product
colors:
  background: "#ffffff"
  text: "#202124"
  accent: "#28665c"
typography:
  body:
    fontFamily: system-ui
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: 8px
spacing:
  unit: 8px
components:
  primaryButton:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: 12px
---

## Overview

Use the shared type, color, and spacing tokens across connected screens.
```

Put explanations in the Markdown body. If present, known sections follow this
order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes,
Components, Do's and Don'ts.

### Accepted Types And Keys

- Top-level keys: `version`, `name`, `description`, `colors`, `typography`,
  `rounded`, `spacing`, `components`. Version/name/description are strings.
- Colors are quoted sRGB hex strings, not objects, token aliases, or `oklch()`.
- Each typography token is an object with required string `fontFamily`.
  Optional keys: `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`,
  `fontFeature`, `fontVariation`. Size/letter spacing use `px`, `em`, or `rem`
  strings; weight is a number; line height is a number or dimension string.
  Font feature/variation are strings.
- Rounded values are dimension strings. Spacing accepts numbers or dimension
  strings. Prefer explicit units when recording visual distances.
- Each component is an object whose portable properties are `backgroundColor`,
  `textColor`, `typography`, `rounded`, `padding`, `size`, `height`, `width`.
  Every property value is a string or string token reference, not an object
  or number. Unknown string properties are preserved with non-blocking warnings,
  as specified by Google's DESIGN.md alpha consumer rules. Keep intentional
  extensions such as `minHeight`; do not rename it to `height`, which changes
  meaning. Prefer `rounded` for corner-radius tokens when equivalent.
  Put narrative descriptions under Markdown `## Components`, not in token fields.

These are the app's supported types, not a claim of full upstream conformance.
The [pinned upstream specification](https://github.com/google-labs-code/design.md/blob/9bf8eae67128b6cc55ad9bf86665767deb4c11cd/docs/spec.md#consumer-behavior-for-unknown-content)
allows component extensions; warnings about them do not require deleting valid data.
Respond to actual validator errors rather than hiding or bypassing the done gate.

## Rules

- Store tokens as canonical values, not long narrative.
- Use sRGB hex colors in frontmatter; keep expressive `oklch()` or CSS-only
  variants in source files unless the validator supports them.
- Prefer semantic token names: background, surface, text, muted, border,
  accent, success, warning, danger.
- If a built-in `brand:<slug>` reference is used, translate it into a
  project-specific `DESIGN.md` rather than editing the built-in reference.
- When revising an existing design, read `DESIGN.md` before changing colors,
  type, spacing, radius, or repeated components.
- If `DESIGN.md` is invalid, repair the schema before `done()`.

## Human Choices And Source Tokens

Read the latest source before broader token edits and preserve current user
selections unless overridden. Reconcile changed source tokens, screen bindings,
and corresponding baton entries explicitly. Matching names do not create a
binding: `tweaks()` does not update unbound files or this document.

For targeted marker-only tweaks, preserve unrelated files; reconcile the baton
during the next substantive token edit rather than expanding a narrow request.

## Don't

- Do not paste full source files, long meeting notes, or tool logs into
  `DESIGN.md`.
- Do not copy brand hex values from memory.
- Do not invent fields outside the Google-compatible top-level keys.
- Do not overwrite user-authored sections just to reformat them.
