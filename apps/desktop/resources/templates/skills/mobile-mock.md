---
schemaVersion: 1
name: mobile-mock
description: >
  Adapts app content, navigation, typography, and controls to phone-sized
  viewports. Use for mobile prototypes or responsive mobile layouts; include
  device chrome only when explicitly requested.
aliases: [mobile, iphone, ios, phone, 手机, 移动端]
dependencies: [artifact-composition, accessibility-states]
validationHints:
  - controls and content remain reachable at the requested mobile viewport
  - navigation and dialogs preserve state and keyboard focus
trigger:
  providers: ['*']
  scope: system
disable_model_invocation: false
user_invocable: true
---

## Fit The Actual Viewport

Design screen content at the requested dimensions. If unspecified, a phone
viewport such as 390 by 844 CSS pixels is a useful starting check, not a fixed
body width for every device. Use fluid widths and content-driven wrapping.

Do not assume the host supplies a status bar, bezel, or safe-area padding.
Inspect the chosen frame/runtime. Add device chrome only when requested,
using a matching scaffold when available; avoid duplicating existing chrome.
Apply supported safe-area insets once and reserve space for fixed navigation
so it does not cover the last row or a form's submit action.

## Legibility And Touch

Use a clear type hierarchy with comfortable body text and readable secondary
labels. Check zoom, wrapping, contrast, and text scaling instead of claiming
a font-size threshold alone proves accessibility.

Aim for at least 44 by 44 CSS-pixel touch areas for primary mobile controls,
including small icon buttons through padding. Avoid hover-only information.
Keep primary actions reachable without requiring a hidden gesture; swipe and
long-press may supplement visible controls, not replace them.

## Navigation And Overlays

Choose tabs, a compact menu, or a back stack according to the task and number
of destinations. Show where the user is. Preserve shared records, selection,
and list context when returning from details or edits.

Dialogs and bottom sheets need a visible close/cancel action, keyboard
dismissal, contained focus when modal, and focus restoration. Ensure the
content and actions remain usable on a short viewport. Screen changes should
move focus deliberately rather than leaving it on removed content.

For a Todo app, completion must update details, filters, and counts together.
Check the affected mobile journey and its empty/recovery state with available
preview actions. A screenshot alone does not establish touch, focus, or
cross-preview persistence.
