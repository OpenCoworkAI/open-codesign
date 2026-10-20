---
"@open-codesign/desktop": patch
"@open-codesign/runtime": patch
"@open-codesign/shared": patch
"@open-codesign/i18n": patch
---

Improve deterministic text editing for generated JSX/TSX: edit independent mixed-child segments, shared local component literals, and lexically traced const/object/static-array string definitions. Display exact source origins and shared-definition scope, bind individual preview fields, and refuse unresolved instance data rather than guessing. Preserve hash conflicts, path safety, and atomic span writes without a model call.

Unify editing into preview selection and one field panel, removing the separate source picker. Support static segments beside dynamic content, disabled control selection, explicit containing-element navigation, and fresh field validation before saving. Retired source-mode IPC requests are explicitly rejected rather than acting as a bypass. Localize editability reasons, source-definition explanations and inspect/save/refresh messages for Chinese and English interfaces, keeping backend reason codes in collapsed diagnostics.

Bind resolved HTML-to-JSX previews to the requested file/design/workspace and refresh sources outside the expanded file tree. Add data-driven browser persistence, shared-reference, mutation/escape, mixed-text, ambiguous-mapping and source-conflict regressions.
