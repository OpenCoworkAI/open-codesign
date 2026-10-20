---
schemaVersion: 1
name: craft-polish
description: >
  Resolves concrete visual and interaction details and exposes meaningful
  source-backed design choices. Use for finishing a working artifact or
  implementing useful tweak controls, not automatic extra polish rounds.
aliases: [polish, interaction-polish, final-pass, craft-pass]
dependencies: []
validationHints:
  - visible controls perform their promised actions and preserve reachable recovery
  - tweak defaults and consumers agree with the rendered design
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Resolve What The User Notices

Inspect the actual result for uneven spacing, weak hierarchy, awkward wrapping,
layout jumps, unclear selection, or missing feedback. Improve specific issues
without accumulating decorative features. Copy feedback, transitions, and
status indicators are useful when they explain real behavior.

Check named component references and keep JSX and CSS readable across lines.
Use complete component-sized edits, not a monolithic rewrite or a separate
tool call for each property. Once the requested result works and the relevant
evidence is sufficient, do not add another generic polish pass.

## Consequential Human Choices

When requested or useful, expose a few decisions with meaningful visual
effects: brand, density, type scale, implemented layout/emphasis, or content
visibility. Do this after the main behavior works, not before the first slice.
Defaults should reflect the brief and the user's current selections.

Trace each key to its actual consumers across relevant screens. CSS variables
serve ordinary visual values; structural JSX must implement its enum/boolean
variants. A key in JSON alone does nothing. Do not imply real authentication,
payment, or backend capability with a switch.

The panel humanizes camelCase keys; enum options are plain strings, not
label/value objects. Explain the design tradeoff in the handoff, not invented
schema fields. For source that implements these choices:

```js
const TWEAK_SCHEMA = /*TWEAK-SCHEMA-BEGIN*/{
  "density": { "kind": "enum", "options": ["comfortable", "compact"] },
  "gap": { "kind": "number", "min": 8, "max": 32, "step": 2, "unit": "px" },
  "showNotes": { "kind": "boolean" }
}/*TWEAK-SCHEMA-END*/;
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "density": "comfortable",
  "gap": 16,
  "showNotes": true
}/*EDITMODE-END*/;
```

Schema keys match defaults. Use `kind: "color"` for colors. Constrain numbers
and options to usable implemented values. `showNotes` must govern notes
content; `density` must select a real layout. The runtime can rerun structural
JSX with updated `TWEAK_DEFAULTS`; do not capture stale derived state.

Check a representative alternate and relevant range boundaries, then restore
the user's defaults. Use artifact controls if present; otherwise edit the exact
bound source values, preview, and restore. Do not leave a test value behind.
Artifact preview cannot click the host tweak panel: these checks do not prove
host-panel interaction or persistence. `tweaks()` does not synchronize unbound
files or `DESIGN.md`.

## Focused Journey Evidence

Check changed entry points, not only the original flow. For a newly added
booking list, cancellation must still be reachable and update the same record
through a direct action or detail view. Include a useful return path and
keyboard/focus behavior. A mental walkthrough is not an executed test.

Use the live preview schema. When it supports interaction steps, select unique
elements from the actual source and assert outcomes, not just successful clicks.
For a task app with these IDs:

```json
{
  "path": "App.jsx",
  "viewport": { "width": 390, "height": 844 },
  "steps": [
    { "action": "fill", "selector": "#new-task", "value": "Buy milk" },
    { "action": "click", "selector": "#add-task" },
    { "action": "assert", "selector": "#task-list", "text": "Buy milk" },
    { "action": "click", "selector": "#settings" },
    { "action": "assert", "selector": "#settings-title", "visible": true },
    { "action": "click", "selector": "#back" },
    { "action": "assert", "selector": "#task-list", "text": "Buy milk" }
  ]
}
```

Use `select` only if the live schema supports it: it chooses an enabled option
by exact value in a native single-selection select. `press` supports Enter,
Escape, and Tab; it does not prove focus landed correctly without observable
evidence. Assertions support visible state, contained text, and exact input
value. Read structured step results and the final view. Calls may reset state;
stay within current step limits rather than pretending calls share a session.
Repair observed failures and recheck affected paths. Report unavailable checks
instead of claiming the whole product was tested.
