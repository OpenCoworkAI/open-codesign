# @open-codesign/runtime

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
