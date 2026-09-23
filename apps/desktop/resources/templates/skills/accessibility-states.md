---
schemaVersion: 1
name: accessibility-states
description: >
  Makes interactive screens usable through semantics, keyboard focus,
  legible content, and reachable validation, empty, error, and success states.
  Use when implementing or changing forms, navigation, dialogs, or record actions.
aliases: [a11y, accessibility, states, keyboard, focus, wcag]
dependencies: []
validationHints:
  - controls have accessible names and usable keyboard paths
  - state transitions preserve input and move or restore focus appropriately
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Semantics And Keyboard

Use native buttons, links, inputs, selects, and form submission. Associate
labels with controls and give icon-only actions accessible names. Use
landmarks and meaningful heading levels; real tables help compare tabular
records. Avoid click-only divs and fake links.

Keep keyboard order aligned with reading order and provide a visible focus
indicator. Expose current/selected/expanded states semantically as appropriate.
Do not rely on color or hover alone for status or instructions.

## Focus Is Part Of The Journey

On a screen change, move focus to a meaningful destination when the previous
control disappears; a focusable page heading is often suitable. Returning
should restore context rather than drop the user at an unrelated control.

Modal dialogs need an accessible name, initial focus, focus containment,
Escape and visible close/cancel actions, and focus restoration. Prefer native
`<dialog>` with `showModal()` where supported. If deletion removes the opener,
restore focus to the next useful action, not a detached element.

## Reachable States

Implement states the actual flow needs, not a disconnected state gallery:

- Validation explains the field and fix, preserves input, and identifies the
  first invalid control on submit.
- Empty results explain the situation and offer a relevant action such as
  clearing filters or creating the first record.
- Errors offer a working recovery path; do not simulate a service failure
  as though a real network request happened.
- Success confirms the state change without blocking continued work.
- Disabled controls explain what is needed. Loading belongs only to actual
  waiting or an explicitly requested loading-state design.

## Visual Access And Checks

Use legible typography, sufficient contrast, wrapping, and comfortable touch
areas. Respect reduced motion. Meaningful images need text alternatives;
decorative images should not add screen-reader noise.

Exercise the affected keyboard and focus path when supported by the available
tools, including entry, submit/close, and return. Check focus in the actual
artifact or report it as untested; visible markup and a clean console do not
prove keyboard behavior or full accessibility conformance.

If page shortcuts exist, check them after pointer navigation has moved focus
to controls, not only on initial load. Respect text entry and native control
activation rather than intercepting every key.
