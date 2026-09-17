---
"@open-codesign/desktop": patch
"@open-codesign/runtime": patch
---

Preserve React component identity, hook state, effects, and uncontrolled inputs when applying live tweaks to components that read tokens during rendering. Saved tweaks and filesystem watcher acknowledgements no longer rerun the artifact module on this path.

Artifacts that capture token values at module scope, render static root JSX/fragments/arrays, or use memoized components retain the previous module-replay behavior so their controls still update. An informational compatibility notice explains the resulting state reset once per artifact; it is not a runtime error and does not fail preview validation. Structural source replacements still rebuild the preview.
