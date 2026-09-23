---
schemaVersion: 1
name: frontend-design-anti-slop
description: >
  Develops a coherent visual direction from the audience, content, and primary
  task. Use for original interface design or an explicitly requested redesign;
  preserve established choices during ordinary revisions.
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Direction From The Brief

Identify what the audience must notice, understand, or do. Choose typography,
composition, density, and tone that support that job. A planning sentence is
enough when the direction is clear; offer alternatives only when requested or
when the choice materially changes the result.

For an existing artifact, work within its visual language unless redesign is
requested. User references and design-system tokens take priority over this
method's suggestions.

## Make The Hierarchy Visible

- Establish a clear reading order with type scale, alignment, spacing, and
  contrast. Let primary information carry more weight than interface chrome.
- Choose fonts for content, language coverage, readability, and available
  assets. Familiar fonts and system fallbacks are valid; unusual fonts are
  not evidence of craft by themselves.
- Use a compact palette with distinct surface, text, border, accent, and
  status roles. White, dark, saturated, or muted treatments can all work.
- Let content shape the layout. A calm task list benefits from clear rows;
  an editorial story may need expressive typography; operational data needs
  efficient comparison. Do not force every brief into the same hero/card grid.
- Make a focal element memorable when useful, and keep surrounding elements
  restrained. Decoration should reinforce meaning rather than conceal sparse
  content or compete with the primary action.

## Detail With Purpose

Use consistent spacing, icon weight, radii, and interaction feedback. Motion
can explain a transition or confirm an action; it should not delay work.
Support reduced motion. Charts need meaningful data and labels, not decorative
shapes pretending to be evidence.

When preview evidence is available, inspect hierarchy, content fit, contrast,
alignment, and the intended viewport. Repair specific weaknesses. Stop when
the brief is well served, rather than adding another effect because it exists.
