# @open-codesign/runtime

## 0.2.0

### Minor Changes

- 3b03e7a: Add deterministic, local source-definition editing for supported workspace JSX/TSX previews. Select a native element in the Files tab and save an existing static text, allowlisted attribute, or inline-style literal without an LLM call. Keep comments and tweaks separate, and explicitly refuse unsupported or ambiguous targets.

  Bind edits to exact source hashes and preview revisions, validate and reparse a single AST-derived patch in the main process, preserve JSX/TSX BOM bytes, and stage atomic single-file writes with conflict checks. Surface saved-but-refresh-failed warnings without rolling back later external changes. Add preview-only provenance, typed IPC contracts, localized editing controls, and focused safety and lifecycle tests; do not add undo/version UI or session history state.

- 03dea98: Switch multi-page prototypes inside one preview document. Matching `id` and `data-oc-screen` values identify each screen, `#id` links select one screen, and shared chrome stays visible. Inactive screens use the `hidden` attribute so their own layout remains intact.

### Patch Changes

- 5f6036b: Replace regex-based webpage stripping with lazy HTML5 text extraction using parse5, preserving untrusted-text semantics without executing scripts or loading page resources. Replace the preview EDITMODE wildcard expression with a forward-only scan to avoid polynomial work on repeated unmatched markers. Add malformed HTML, deep nesting, and adversarial marker regression coverage.
- 4cf3393: Add a local design system library with built-in previews, personal forks, DESIGN.md imports, session-backed editing and optional system selection when creating designs. Preserve independent workspace copies and connect component annotations to canonical design rules.

  Present system details as a full content view with sidebar actions, a fitted interactive overview and an expandable specification reader. Resolve built-ins from the current app bundle so legacy user-owned references cannot disable shipped systems.

  Initialize the optional library only when handling a request, so unavailable bundled references do not prevent the desktop application from starting.

- 787a8e4: Improve deterministic text editing for generated JSX/TSX: edit independent mixed-child segments, shared local component literals, and lexically traced const/object/static-array string definitions. Display exact source origins and shared-definition scope, bind individual preview fields, and refuse unresolved instance data rather than guessing. Preserve hash conflicts, path safety, and atomic span writes without a model call.

  Unify editing into preview selection and one field panel, removing the separate source picker. Support static segments beside dynamic content, disabled control selection, explicit containing-element navigation, and fresh field validation before saving. Retired source-mode IPC requests are explicitly rejected rather than acting as a bypass. Localize editability reasons, source-definition explanations and inspect/save/refresh messages for Chinese and English interfaces, keeping backend reason codes in collapsed diagnostics.

  Bind resolved HTML-to-JSX previews to the requested file/design/workspace and refresh sources outside the expanded file tree. Add data-driven browser persistence, shared-reference, mutation/escape, mixed-text, ambiguous-mapping and source-conflict regressions.

- Updated dependencies [c3d2ff3]
- Updated dependencies [029128d]
- Updated dependencies [0d3d63e]
- Updated dependencies [a63feb5]
- Updated dependencies [761b3b8]
- Updated dependencies [3b03e7a]
- Updated dependencies [e24d1f1]
- Updated dependencies [24815f3]
- Updated dependencies [6799d55]
- Updated dependencies [c9757a0]
- Updated dependencies [9574745]
- Updated dependencies [e331e69]
- Updated dependencies [856dba8]
- Updated dependencies [ec7f76d]
- Updated dependencies [b7a0090]
- Updated dependencies [c9757a0]
- Updated dependencies [719d089]
- Updated dependencies [143cf96]
- Updated dependencies [4cf3393]
- Updated dependencies [787a8e4]
- Updated dependencies [09f21c3]
- Updated dependencies [5f6036b]
  - @open-codesign/shared@0.3.0

## 0.1.7

### Patch Changes

- 7e8f7ff: Use system-ui instead of an implicitly downloaded DM Sans font for JSX previews and standalone exports. Request only supported Google Fonts families explicitly referenced by artifact source, with no font-service requests or preconnects for system-font designs. Explicit Fraunces, DM Serif Display, DM Sans and JetBrains Mono choices retain their existing styles.
- a8de894: Add window-local fullscreen preview for runnable JSX and HTML. Hide navigation panels without remounting the artifact, preserve form and navigation state, restore panels on exit, and forward unconsumed sandbox Escape events through the trusted preview bridge.
- 971918b: Allow interactive preview forms to run client-side submit handlers while blocking native form navigation with browser-enforced CSP. Keep standalone exports and connected development-server policies unchanged.
- a3a08e6: Keep canvas comments tied to the host-resolved preview source file, including dedicated file tabs and persisted session comments. Edit prompts now use pi's read/edit tools and describe DOM targets as evidence rather than exact source-code locations; imported components still require source inspection.

  Correct duplicate/special-character ID selection and nested SVG rectangle tracking, preserve existing outlines, and clear stale selection when the selected layer disappears or the preview changes. Store comment rectangles in unscaled iframe coordinates and reject malformed geometry messages.

- 729e356: Preserve React component identity, hook state, effects, and uncontrolled inputs when applying live tweaks to components that read tokens during rendering. Saved tweaks and filesystem watcher acknowledgements no longer rerun the artifact module on this path.

  Artifacts that capture token values at module scope, render static root JSX/fragments/arrays, or use memoized components or memoization hooks (`useMemo` / `useCallback`) retain the previous module-replay behavior so their controls still update. Memoization hooks are conservatively classified even when a particular hook does not read tokens, because closures may capture values before the hook executes. An informational compatibility notice, localized in all four app languages, explains the resulting state reset once per artifact; it is not a runtime error and does not fail preview validation. Structural source replacements still rebuild the preview.

- 0c1beb0: Keep existing fragment links inside the rendered preview even when a workspace
  base URL is present. Scroll to the target instead of requesting a workspace
  directory as a page, and retain the boundary for missing targets and external
  navigation.
- Updated dependencies [729e356]
- Updated dependencies [f2a9dbb]
- Updated dependencies [d199c75]
- Updated dependencies [a3a08e6]
- Updated dependencies [729e356]
- Updated dependencies [ef5677c]
- Updated dependencies [729e356]
  - @open-codesign/shared@0.2.2

## 0.1.6

### Patch Changes

- Updated dependencies [7a1977d]
- Updated dependencies [6cbb639]
  - @open-codesign/shared@0.3.0

## 0.1.5

### Patch Changes

- 4c66392: Harden HTML, URL, marker, stack-frame, and retry parsing paths flagged by CodeQL during the v0.2 mainline promotion.
- Updated dependencies [4cec7ea]
- Updated dependencies [4391788]
- Updated dependencies [4c66392]
- Updated dependencies [0a0ff2e]
- Updated dependencies [19b2909]
- Updated dependencies [6c3a908]
- Updated dependencies [418e5a8]
- Updated dependencies [022e1b6]
- Updated dependencies [441e7c7]
- Updated dependencies [e622d62]
- Updated dependencies [d815de5]
- Updated dependencies [a5f1cc0]
- Updated dependencies [b2a6d15]
- Updated dependencies [013fd34]
- Updated dependencies [d3a62fe]
  - @open-codesign/shared@0.2.0
