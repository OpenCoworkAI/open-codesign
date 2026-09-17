---
"@open-codesign/desktop": patch
"@open-codesign/runtime": patch
---

Preserve React component identity, hook state, effects, and uncontrolled inputs when applying live tweaks to components that read tokens during rendering. Saved tweaks and filesystem watcher acknowledgements no longer rerun the artifact module on this path.

Artifacts that capture token values at module scope, render static root JSX/fragments/arrays, or use memoized components or memoization hooks (`useMemo` / `useCallback`) retain the previous module-replay behavior so their controls still update. Memoization hooks are conservatively classified even when a particular hook does not read tokens, because closures may capture values before the hook executes. An informational compatibility notice, localized in all four app languages, explains the resulting state reset once per artifact; it is not a runtime error and does not fail preview validation. Structural source replacements still rebuild the preview.
