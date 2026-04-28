---
schemaVersion: 1
name: craft-polish
description: >
  Adds the final interaction and craft surplus pass that prevents generic AI UI:
  real clickable states, view transitions, empty states, rhythm breaks, and
  component-reference self-checks. Use before final `done`.
aliases: [polish, interaction-polish, final-pass, craft-pass]
dependencies: []
validationHints:
  - final artifact includes focus and hover states for actions
  - operational surfaces include empty loading or error states
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Interactive Minimum

Before `done`, run a final craft pass. For app/tool surfaces, every clickable element must do something: change state, open a modal/drawer, switch a tab, reveal content, copy, dismiss, or show a toast. Pure hover does not count. For static one-pagers, only visible controls need behavior; decorative links can be styled as inert only when they are clearly not the point of the artifact.

Include:

- At least 3 observable state changes when the artifact is an app/tool surface.
- Animated view transitions for tabs or navigation.
- Hover, press, and focus styles on every action.
- One empty-state variant for a list, grid, table, chart, or inbox.
- Active navigation indicator that uses shape/weight, not color alone.

## Empty, Loading, Error

Every operational surface should include at least one non-happy-path state:

- Empty: explain what is missing, show one next action, and avoid sad blank panels.
- Loading: use skeletons that match the final layout, not generic gray bars.
- Error: include a human-readable cause and a retry or fallback action.
- Offline/disabled: use opacity plus text/shape, not color alone.

## Craft Surplus

Add at least 3 small details when the surface supports them:

- Stateful badge or counter with a small animation.
- Keyboard shortcut chip.
- Copy feedback.
- Dismissible toast/banner.
- Tooltip with directional arrow.
- Relative-time tick.
- Segmented control.
- Accordion or drawer.
- Deliberate visual rhythm break.

## Motion And Focus

- Keep UI motion under 300ms, usually 120-200ms.
- Use `transform` and `opacity` for transitions; avoid layout-jank animations.
- Respect `prefers-reduced-motion` for looping or large movement.
- Focus rings must be visible on keyboard navigation.
- Hover and pressed states should change at least two cues: surface, border, shadow, icon, text weight, or transform.

## Final Self-Check

Before `done`:

- Audit every JSX `<PascalCase />` reference and confirm a matching component definition or runtime-provided component exists.
- Click-path mentally through the default view plus hidden tabs, drawers, modals, and accordions.
- Check that no card, button, tab, chart, or list row shifts size unexpectedly on hover/state change.
- Remove debug labels, placeholder copy, "TODO", "lorem", fake filenames, and generic names.
- Ensure `TWEAK_DEFAULTS` exposes only meaningful controls, not every pixel.
